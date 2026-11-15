import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BillStatus,
  JournalSourceType,
  PaymentDirection,
  PaymentMethod,
  Prisma,
  Vendor,
} from '@prisma/client';
import { LedgerEngine, toDate, toNumber } from '../ledger/ledger-engine';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../tenant/audit.service';
import { ScopedDataAccess } from '../tenant/scoped-data-access.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { CreateBillPaymentDto, ListBillPaymentsDto } from './bill-payment.dto';

const BILL_PAYMENT_INCLUDE = {
  vendor: true,
  applications: {
    orderBy: { createdAt: 'asc' },
    include: {
      bill: {
        select: {
          id: true,
          number: true,
          status: true,
          total: true,
          amountPaid: true,
          dueDate: true,
        },
      },
    },
  },
} as const;

type BillPaymentRow = Prisma.BillPaymentGetPayload<{ include: typeof BILL_PAYMENT_INCLUDE }>;

interface LockedBill {
  id: string;
  number: string;
  vendorId: string;
  status: string;
  total: Prisma.Decimal | string;
  amountPaid: Prisma.Decimal | string;
}

export interface BillPaymentView {
  id: string;
  number: string;
  direction: PaymentDirection;
  vendorId: string;
  vendor: {
    id: string;
    code: string;
    name: string;
    email: string | null;
  };
  date: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  applications: Array<{
    id: string;
    billId: string;
    amount: number;
    bill: {
      id: string;
      number: string;
      status: BillStatus;
      total: number;
      amountPaid: number;
      balanceDue: number;
    };
  }>;
  createdAt: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

@Injectable()
export class BillPaymentsService {
  constructor(
    private readonly scoped: ScopedDataAccess,
    private readonly tenant: TenantContextService,
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerEngine,
    private readonly audit: AuditService,
  ) {}

  async list(filters: ListBillPaymentsDto): Promise<BillPaymentView[]> {
    const where: Record<string, unknown> = {};
    if (filters.vendorId) where.vendorId = filters.vendorId;
    const search = filters.search?.trim();
    if (search) {
      where.OR = [
        { number: { contains: search, mode: 'insensitive' } },
        { reference: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
        { vendor: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }
    const rows = await this.scoped.findMany<BillPaymentRow>('billPayment', {
      where,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 250,
      include: BILL_PAYMENT_INCLUDE,
    });
    return rows.map((row) => this.toView(row));
  }

  async find(id: string): Promise<BillPaymentView> {
    return this.toView(await this.findRow(id));
  }

  async create(input: CreateBillPaymentDto): Promise<BillPaymentView> {
    const { organizationId } = await this.tenant.get();
    const vendor = await this.resolveVendor(input.vendorId);
    const date = toDate(input.date ?? todayIso(), 'date');
    const amount = new Prisma.Decimal(input.amount);
    const applications = input.applications.map((application) => ({
      billId: application.billId,
      amount: new Prisma.Decimal(application.amount),
    }));

    const uniqueBillIds = new Set(applications.map((application) => application.billId));
    if (uniqueBillIds.size !== applications.length) {
      throw new BadRequestException('A bill can only appear once in a payment');
    }
    const appliedTotal = applications.reduce(
      (sum, application) => sum.plus(application.amount),
      new Prisma.Decimal(0),
    );
    if (!appliedTotal.equals(amount)) {
      throw new BadRequestException('Payment amount must equal the amount applied to bills');
    }

    let paymentId: string | undefined;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        paymentId = await this.prisma.$transaction(async (tx) => {
          const locked = await tx.$queryRaw<LockedBill[]>(Prisma.sql`
            SELECT id, number, "vendorId", status, total, "amountPaid"
            FROM "Bill"
            WHERE "organizationId" = ${organizationId}
              AND id IN (${Prisma.join([...uniqueBillIds])})
            ORDER BY id
            FOR UPDATE
          `);
          if (locked.length !== uniqueBillIds.size) {
            throw new BadRequestException(
              'Every application must reference a bill in this organization',
            );
          }

          const bills = new Map(locked.map((bill) => [bill.id, bill]));
          const paidAt = new Date(`${isoDate(date)}T12:00:00.000Z`);
          const updates = applications.map((application) => {
            const bill = bills.get(application.billId);
            if (!bill) {
              throw new BadRequestException('Every application must reference a bill');
            }
            if (bill.vendorId !== vendor.id) {
              throw new BadRequestException('Every bill must belong to the payment vendor');
            }
            if (
              bill.status !== BillStatus.OPEN &&
              bill.status !== BillStatus.PARTIAL
            ) {
              throw new BadRequestException(`Bill ${bill.number} is not open for payment`);
            }

            const total = new Prisma.Decimal(bill.total);
            const amountPaid = new Prisma.Decimal(bill.amountPaid);
            const balance = total.minus(amountPaid);
            if (application.amount.gt(balance)) {
              throw new BadRequestException(
                `Payment exceeds the ${balance.toFixed(2)} balance on bill ${bill.number}`,
              );
            }
            const newPaid = amountPaid.plus(application.amount);
            const paidInFull = newPaid.equals(total);
            return {
              bill,
              newPaid,
              status: paidInFull ? BillStatus.PAID : BillStatus.PARTIAL,
              paidAt: paidInFull ? paidAt : null,
            };
          });

          const number = await this.nextNumber(tx, organizationId);
          const payment = await tx.billPayment.create({
            data: {
              organizationId,
              number,
              vendorId: vendor.id,
              date,
              amount,
              method: input.method ?? PaymentMethod.BANK_TRANSFER,
              reference: input.reference?.trim() || null,
              notes: input.notes?.trim() || null,
              applications: {
                create: applications.map((application) => ({
                  organizationId,
                  billId: application.billId,
                  amount: application.amount,
                })),
              },
            },
            select: { id: true, number: true },
          });

          for (const update of updates) {
            await tx.bill.update({
              where: { id: update.bill.id },
              data: {
                amountPaid: update.newPaid,
                status: update.status,
                paidAt: update.paidAt,
              },
            });
          }

          const [payable, cash] = await Promise.all([
            tx.account.findFirst({
              where: { organizationId, code: '2000', active: true },
              select: { id: true },
            }),
            tx.account.findFirst({
              where: { organizationId, code: '1000', active: true },
              select: { id: true },
            }),
          ]);
          if (!payable) {
            throw new BadRequestException('An active Accounts payable account is required');
          }
          if (!cash) {
            throw new BadRequestException('An active Cash account is required');
          }

          await this.ledger.postWithin(tx, organizationId, {
            date: isoDate(date),
            memo: `Bill payment ${payment.number} — ${vendor.name}`,
            sourceType: JournalSourceType.PAYMENT,
            sourceId: payment.id,
            lines: [
              {
                accountId: payable.id,
                debit: amount,
                description: `Bill payment ${payment.number}`,
              },
              {
                accountId: cash.id,
                credit: amount,
                description: `Bill payment ${payment.number}`,
              },
            ],
          });
          return payment.id;
        });
        break;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          continue;
        }
        throw error;
      }
    }
    if (!paymentId) {
      throw new ConflictException('Could not allocate a bill payment number; try again');
    }

    const payment = await this.find(paymentId);
    await this.audit.record('bill.pay', 'BillPayment', payment.id, {
      number: payment.number,
      vendorId: payment.vendorId,
      vendor: payment.vendor.name,
      amount: payment.amount,
      billNumbers: payment.applications.map((application) => application.bill.number),
    });
    return payment;
  }

  private async findRow(id: string): Promise<BillPaymentRow> {
    const row = await this.scoped.findById<BillPaymentRow>('billPayment', id, {
      include: BILL_PAYMENT_INCLUDE,
    });
    if (!row) {
      throw new NotFoundException('Bill payment not found');
    }
    return row;
  }

  private async resolveVendor(vendorId: string): Promise<Vendor> {
    const vendor = await this.scoped.findById<Vendor>('vendor', vendorId);
    if (!vendor) {
      throw new BadRequestException('Vendor must belong to this organization');
    }
    if (!vendor.active) {
      throw new BadRequestException('Vendor is inactive');
    }
    return vendor;
  }

  private async nextNumber(
    tx: Prisma.TransactionClient,
    organizationId: string,
  ): Promise<string> {
    const rows = await tx.billPayment.findMany({
      where: { organizationId, number: { startsWith: 'BPAY-' } },
      orderBy: { number: 'desc' },
      select: { number: true },
      take: 1,
    });
    const last = Number.parseInt(rows[0]?.number.slice('BPAY-'.length) ?? '0', 10);
    const next = Number.isFinite(last) ? last + 1 : 1;
    return `BPAY-${String(next).padStart(4, '0')}`;
  }

  private toView(row: BillPaymentRow): BillPaymentView {
    return {
      id: row.id,
      number: row.number,
      direction: PaymentDirection.SENT,
      vendorId: row.vendorId,
      vendor: {
        id: row.vendor.id,
        code: row.vendor.code,
        name: row.vendor.name,
        email: row.vendor.email,
      },
      date: isoDate(row.date),
      amount: toNumber(row.amount),
      method: row.method,
      reference: row.reference,
      notes: row.notes,
      applications: row.applications.map((application) => {
        const total = toNumber(application.bill.total);
        const amountPaid = toNumber(application.bill.amountPaid);
        return {
          id: application.id,
          billId: application.billId,
          amount: toNumber(application.amount),
          bill: {
            id: application.bill.id,
            number: application.bill.number,
            status: application.bill.status,
            total,
            amountPaid,
            balanceDue: Number((total - amountPaid).toFixed(2)),
          },
        };
      }),
      createdAt: row.createdAt.toISOString(),
    };
  }
}
