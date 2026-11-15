import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Customer,
  InvoiceStatus,
  JournalSourceType,
  PaymentDirection,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import { LedgerEngine, toDate, toNumber } from '../ledger/ledger-engine';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../tenant/audit.service';
import { ScopedDataAccess } from '../tenant/scoped-data-access.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { CreatePaymentDto, ListPaymentsDto } from './payment.dto';

const PAYMENT_INCLUDE = {
  customer: true,
  applications: {
    orderBy: { createdAt: 'asc' },
    include: {
      invoice: {
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

type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof PAYMENT_INCLUDE }>;

interface LockedInvoice {
  id: string;
  number: string;
  customerId: string;
  status: string;
  total: Prisma.Decimal | string;
  amountPaid: Prisma.Decimal | string;
}

interface PreparedPayment {
  customer: Customer;
  date: Date;
  amount: Prisma.Decimal;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  applications: Array<{ invoiceId: string; amount: Prisma.Decimal }>;
  uniqueInvoiceIds: Set<string>;
}

export interface PaymentView {
  id: string;
  number: string;
  direction: PaymentDirection;
  customerId: string;
  customer: {
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
    invoiceId: string;
    amount: number;
    invoice: {
      id: string;
      number: string;
      status: InvoiceStatus;
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
export class PaymentsService {
  constructor(
    private readonly scoped: ScopedDataAccess,
    private readonly tenant: TenantContextService,
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerEngine,
    private readonly audit: AuditService,
  ) {}

  async list(filters: ListPaymentsDto): Promise<PaymentView[]> {
    const where: Record<string, unknown> = {};
    if (filters.customerId) where.customerId = filters.customerId;
    const search = filters.search?.trim();
    if (search) {
      where.OR = [
        { number: { contains: search, mode: 'insensitive' } },
        { reference: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }
    const rows = await this.scoped.findMany<PaymentRow>('payment', {
      where,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 250,
      include: PAYMENT_INCLUDE,
    });
    return rows.map((row) => this.toView(row));
  }

  async find(id: string): Promise<PaymentView> {
    return this.toView(await this.findRow(id));
  }

  async create(input: CreatePaymentDto): Promise<PaymentView> {
    const { organizationId } = await this.tenant.get();
    const prepared = await this.prepareCreate(input);
    const cash = await this.resolveCash();

    let paymentId: string | undefined;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const created = await this.prisma.$transaction((tx) =>
          this.createWithin(tx, organizationId, prepared, cash.id),
        );
        paymentId = created.id;
        break;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          continue;
        }
        throw error;
      }
    }
    if (!paymentId) {
      throw new ConflictException('Could not allocate a payment number; try again');
    }

    const payment = await this.find(paymentId);
    await this.audit.record('payment.create', 'Payment', payment.id, {
      number: payment.number,
      customerId: payment.customerId,
      customer: payment.customer.name,
      amount: payment.amount,
      invoiceNumbers: payment.applications.map((application) => application.invoice.number),
    });
    return payment;
  }

  async createFromBankTransaction(
    tx: Prisma.TransactionClient,
    organizationId: string,
    input: CreatePaymentDto,
    depositAccountId: string,
  ): Promise<{ id: string; number: string }> {
    const prepared = await this.prepareCreate(input);
    return this.createWithin(tx, organizationId, prepared, depositAccountId);
  }

  private async prepareCreate(input: CreatePaymentDto): Promise<PreparedPayment> {
    const customer = await this.resolveCustomer(input.customerId);
    const applications = input.applications.map((application) => ({
      invoiceId: application.invoiceId,
      amount: new Prisma.Decimal(application.amount),
    }));
    const uniqueInvoiceIds = new Set(applications.map((application) => application.invoiceId));
    if (uniqueInvoiceIds.size !== applications.length) {
      throw new BadRequestException('An invoice can only appear once in a payment');
    }
    const amount = new Prisma.Decimal(input.amount);
    const appliedTotal = applications.reduce(
      (sum, application) => sum.plus(application.amount),
      new Prisma.Decimal(0),
    );
    if (!appliedTotal.equals(amount)) {
      throw new BadRequestException('Payment amount must equal the amount applied to invoices');
    }
    return {
      customer,
      date: toDate(input.date ?? todayIso(), 'date'),
      amount,
      method: input.method ?? PaymentMethod.BANK_TRANSFER,
      reference: input.reference?.trim() || null,
      notes: input.notes?.trim() || null,
      applications,
      uniqueInvoiceIds,
    };
  }

  private async createWithin(
    tx: Prisma.TransactionClient,
    organizationId: string,
    prepared: PreparedPayment,
    depositAccountId: string,
  ): Promise<{ id: string; number: string }> {
    const locked = await tx.$queryRaw<LockedInvoice[]>(Prisma.sql`
      SELECT id, number, "customerId", status, total, "amountPaid"
      FROM "Invoice"
      WHERE "organizationId" = ${organizationId}
        AND id IN (${Prisma.join([...prepared.uniqueInvoiceIds])})
      ORDER BY id
      FOR UPDATE
    `);
    if (locked.length !== prepared.uniqueInvoiceIds.size) {
      throw new BadRequestException(
        'Every application must reference an invoice in this organization',
      );
    }

    const invoices = new Map(locked.map((invoice) => [invoice.id, invoice]));
    const paidAt = new Date(`${isoDate(prepared.date)}T12:00:00.000Z`);
    const updates = prepared.applications.map((application) => {
      const invoice = invoices.get(application.invoiceId);
      if (!invoice) {
        throw new BadRequestException('Every application must reference an invoice');
      }
      if (invoice.customerId !== prepared.customer.id) {
        throw new BadRequestException('Every invoice must belong to the payment customer');
      }
      if (invoice.status !== InvoiceStatus.SENT && invoice.status !== InvoiceStatus.PARTIAL) {
        throw new BadRequestException(`Invoice ${invoice.number} is not open for payment`);
      }

      const total = new Prisma.Decimal(invoice.total);
      const amountPaid = new Prisma.Decimal(invoice.amountPaid);
      const balance = total.minus(amountPaid);
      if (application.amount.gt(balance)) {
        throw new BadRequestException(
          `Payment exceeds the ${balance.toFixed(2)} balance on invoice ${invoice.number}`,
        );
      }
      const newPaid = amountPaid.plus(application.amount);
      const paidInFull = newPaid.equals(total);
      return {
        invoice,
        newPaid,
        status: paidInFull ? InvoiceStatus.PAID : InvoiceStatus.PARTIAL,
        paidAt: paidInFull ? paidAt : null,
      };
    });

    const number = await this.nextNumber(tx, organizationId);
    const payment = await tx.payment.create({
      data: {
        organizationId,
        number,
        direction: PaymentDirection.RECEIVED,
        customerId: prepared.customer.id,
        date: prepared.date,
        amount: prepared.amount,
        method: prepared.method,
        reference: prepared.reference,
        notes: prepared.notes,
        applications: {
          create: prepared.applications.map((application) => ({
            organizationId,
            invoiceId: application.invoiceId,
            amount: application.amount,
          })),
        },
      },
      select: { id: true, number: true },
    });

    for (const update of updates) {
      await tx.invoice.update({
        where: { id: update.invoice.id },
        data: {
          amountPaid: update.newPaid,
          status: update.status,
          paidAt: update.paidAt,
        },
      });
    }

    const [deposit, receivable] = await Promise.all([
      tx.account.findFirst({
        where: { organizationId, id: depositAccountId, active: true },
        select: { id: true },
      }),
      tx.account.findFirst({
        where: { organizationId, code: '1100', active: true },
        select: { id: true },
      }),
    ]);
    if (!deposit) {
      throw new BadRequestException('An active funding account is required');
    }
    if (!receivable) {
      throw new BadRequestException('An active Accounts receivable account is required');
    }

    await this.ledger.postWithin(tx, organizationId, {
      date: isoDate(prepared.date),
      memo: `Payment ${payment.number} — ${prepared.customer.name}`,
      sourceType: JournalSourceType.PAYMENT,
      sourceId: payment.id,
      lines: [
        {
          accountId: deposit.id,
          debit: prepared.amount,
          description: `Payment ${payment.number}`,
        },
        {
          accountId: receivable.id,
          credit: prepared.amount,
          description: `Payment ${payment.number}`,
        },
      ],
    });
    return payment;
  }

  private async resolveCash(): Promise<{ id: string }> {
    const cash = await this.scoped.findMany<{ id: string }>('account', {
      where: { code: '1000', active: true },
      select: { id: true },
      take: 1,
    });
    if (cash.length === 0) {
      throw new BadRequestException('An active Cash account is required');
    }
    return cash[0];
  }

  private async findRow(id: string): Promise<PaymentRow> {
    const row = await this.scoped.findById<PaymentRow>('payment', id, {
      include: PAYMENT_INCLUDE,
    });
    if (!row) {
      throw new NotFoundException('Payment not found');
    }
    return row;
  }

  private async resolveCustomer(customerId: string): Promise<Customer> {
    const customer = await this.scoped.findById<Customer>('customer', customerId);
    if (!customer) {
      throw new BadRequestException('Customer must belong to this organization');
    }
    if (!customer.active) {
      throw new BadRequestException('Customer is inactive');
    }
    return customer;
  }

  private async nextNumber(
    tx: Prisma.TransactionClient,
    organizationId: string,
  ): Promise<string> {
    const rows = await tx.payment.findMany({
      where: { organizationId, number: { startsWith: 'PAY-' } },
      orderBy: { number: 'desc' },
      select: { number: true },
      take: 1,
    });
    const last = Number.parseInt(rows[0]?.number.slice('PAY-'.length) ?? '0', 10);
    const next = Number.isFinite(last) ? last + 1 : 1;
    return `PAY-${String(next).padStart(4, '0')}`;
  }

  private toView(row: PaymentRow): PaymentView {
    return {
      id: row.id,
      number: row.number,
      direction: row.direction,
      customerId: row.customerId,
      customer: {
        id: row.customer.id,
        code: row.customer.code,
        name: row.customer.name,
        email: row.customer.email,
      },
      date: isoDate(row.date),
      amount: toNumber(row.amount),
      method: row.method,
      reference: row.reference,
      notes: row.notes,
      applications: row.applications.map((application) => {
        const total = toNumber(application.invoice.total);
        const amountPaid = toNumber(application.invoice.amountPaid);
        return {
          id: application.id,
          invoiceId: application.invoiceId,
          amount: toNumber(application.amount),
          invoice: {
            id: application.invoice.id,
            number: application.invoice.number,
            status: application.invoice.status,
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
