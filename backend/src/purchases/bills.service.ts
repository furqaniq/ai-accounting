import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AgentDomainEventType,
  BillStatus,
  JournalSourceType,
  Prisma,
  Vendor,
} from '@prisma/client';
import { DomainEventsService } from '../events/domain-events.service';
import { LedgerEngine, toDate, toNumber } from '../ledger/ledger-engine';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../tenant/audit.service';
import { ScopedDataAccess } from '../tenant/scoped-data-access.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { BillLineDto, CreateBillDto, ListBillsDto, UpdateBillDto } from './bill.dto';

const BILL_INCLUDE = {
  vendor: true,
  lines: {
    orderBy: { position: 'asc' },
    include: {
      expenseAccount: { select: { id: true, code: true, name: true, type: true } },
    },
  },
} as const;

type BillRow = Prisma.BillGetPayload<{ include: typeof BILL_INCLUDE }>;

export type BillDisplayStatus = 'DRAFT' | 'OPEN' | 'PARTIAL' | 'PAID' | 'OVERDUE';

export interface BillLineView {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  expenseAccountId: string;
  expenseAccount: { id: string; code: string; name: string; type: string };
}

export interface BillView {
  id: string;
  number: string;
  status: BillDisplayStatus;
  vendorId: string;
  vendor: {
    id: string;
    code: string;
    name: string;
    contactName: string | null;
    email: string | null;
    phone: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    region: string | null;
    postalCode: string | null;
    country: string | null;
  };
  issueDate: string;
  dueDate: string;
  openedAt: string | null;
  paidAt: string | null;
  taxRate: number;
  subtotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  daysOverdue: number;
  notes: string | null;
  lines: BillLineView[];
  createdAt: string;
  updatedAt: string;
}

interface ComputedLine {
  description: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  amount: Prisma.Decimal;
  expenseAccountId: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function dayNumber(value: string): number {
  return Math.floor(Date.parse(`${value}T00:00:00.000Z`) / 86_400_000);
}

function displayStatus(row: BillRow, today = todayIso()): BillDisplayStatus {
  if (row.status === BillStatus.OPEN || row.status === BillStatus.PARTIAL) {
    if (row.total.minus(row.amountPaid).gt(0) && isoDate(row.dueDate) < today) {
      return 'OVERDUE';
    }
  }
  return row.status;
}

@Injectable()
export class BillsService {
  constructor(
    private readonly scoped: ScopedDataAccess,
    private readonly tenant: TenantContextService,
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerEngine,
    private readonly audit: AuditService,
    private readonly events: DomainEventsService,
  ) {}

  async list(filters: ListBillsDto): Promise<BillView[]> {
    const where: Record<string, unknown> = {};
    if (filters.vendorId) where.vendorId = filters.vendorId;
    const search = filters.search?.trim();
    if (search) {
      where.OR = [
        { number: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
        { vendor: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const rows = await this.scoped.findMany<BillRow>('bill', {
      where,
      orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
      take: 250,
      include: BILL_INCLUDE,
    });
    const today = todayIso();
    const views = rows.map((row) => this.toView(row, today));
    return filters.status
      ? views.filter((bill) => bill.status === filters.status)
      : views;
  }

  async find(id: string): Promise<BillView> {
    return this.toView(await this.findRow(id));
  }

  async create(input: CreateBillDto): Promise<BillView> {
    const { organizationId } = await this.tenant.get();
    const vendor = await this.resolveVendor(input.vendorId);
    const lines = await this.resolveLines(input.lines);
    const taxRate = await this.resolveTaxRate(input.taxRate);
    const issueDate = toDate(input.issueDate ?? todayIso(), 'issueDate');
    const dueDate = toDate(input.dueDate, 'dueDate');
    this.assertDates(issueDate, dueDate);
    const totals = this.computeTotals(lines, taxRate);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const bill = await this.scoped.create<BillRow>('bill', {
          number: await this.nextNumber(),
          vendorId: vendor.id,
          status: BillStatus.DRAFT,
          issueDate,
          dueDate,
          taxRate,
          ...totals,
          notes: input.notes?.trim() || null,
          lines: {
            create: lines.map((line, index) => ({
              organizationId,
              position: index,
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              amount: line.amount,
              expenseAccountId: line.expenseAccountId,
            })),
          },
        });
        await this.audit.record('bill.create', 'Bill', bill.id, {
          number: bill.number,
          vendorId: vendor.id,
          vendor: vendor.name,
          total: toNumber(totals.total),
        });
        return this.find(bill.id);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          continue;
        }
        throw error;
      }
    }
    throw new ConflictException('Could not allocate a bill number; try again');
  }

  async update(id: string, input: UpdateBillDto): Promise<BillView> {
    const { organizationId } = await this.tenant.get();
    const current = await this.findRow(id);
    if (current.status !== BillStatus.DRAFT) {
      throw new BadRequestException('Only draft bills can be edited');
    }

    const vendorId = input.vendorId ?? current.vendorId;
    const vendor =
      vendorId === current.vendorId
        ? { id: current.vendor.id, name: current.vendor.name }
        : await this.resolveVendor(vendorId);

    const lines = input.lines
      ? await this.resolveLines(input.lines)
      : current.lines.map((line) => ({
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          amount: line.amount,
          expenseAccountId: line.expenseAccountId,
        }));
    const taxRate =
      input.taxRate !== undefined ? new Prisma.Decimal(input.taxRate) : current.taxRate;
    const issueDate = input.issueDate ? toDate(input.issueDate, 'issueDate') : current.issueDate;
    const dueDate = input.dueDate ? toDate(input.dueDate, 'dueDate') : current.dueDate;
    this.assertDates(issueDate, dueDate);
    const totals = this.computeTotals(lines, taxRate);
    const notes = input.notes !== undefined ? input.notes.trim() || null : current.notes;

    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.bill.updateMany({
        where: { id, organizationId, status: BillStatus.DRAFT },
        data: {
          vendorId,
          issueDate,
          dueDate,
          taxRate,
          ...totals,
          notes,
        },
      });
      if (changed.count === 0) {
        throw new BadRequestException('Only draft bills can be edited');
      }
      await tx.billLine.deleteMany({ where: { organizationId, billId: id } });
      await tx.billLine.createMany({
        data: lines.map((line, index) => ({
          organizationId,
          billId: id,
          position: index,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          amount: line.amount,
          expenseAccountId: line.expenseAccountId,
        })),
      });
    });

    await this.audit.record('bill.update', 'Bill', id, {
      number: current.number,
      vendorId,
      vendor: vendor.name,
      total: toNumber(totals.total),
      lines: lines.length,
    });
    return this.find(id);
  }

  async open(id: string): Promise<BillView> {
    const { organizationId } = await this.tenant.get();
    const outcome = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM "Bill"
        WHERE "organizationId" = ${organizationId} AND id = ${id}
        FOR UPDATE
      `);
      if (locked.length === 0) {
        throw new NotFoundException('Bill not found');
      }

      const bill = await tx.bill.findFirst({
        where: { id, organizationId },
        include: { vendor: true, lines: { orderBy: { position: 'asc' } } },
      });
      if (!bill) {
        throw new NotFoundException('Bill not found');
      }
      if (bill.status !== BillStatus.DRAFT) {
        return { posted: false, number: bill.number };
      }

      const [payable, purchaseTax] = await Promise.all([
        tx.account.findFirst({
          where: { organizationId, code: '2000', active: true },
          select: { id: true },
        }),
        tx.account.findFirst({
          where: { organizationId, code: '1300', active: true },
          select: { id: true },
        }),
      ]);
      if (!payable) {
        throw new BadRequestException('An active Accounts payable account is required');
      }
      if (bill.taxTotal.gt(0) && !purchaseTax) {
        throw new BadRequestException('An active Purchase tax receivable account is required');
      }

      const expenseByAccount = new Map<string, Prisma.Decimal>();
      for (const line of bill.lines) {
        expenseByAccount.set(
          line.expenseAccountId,
          (expenseByAccount.get(line.expenseAccountId) ?? new Prisma.Decimal(0)).plus(
            line.amount,
          ),
        );
      }

      const journalLines = [
        ...[...expenseByAccount.entries()].map(([accountId, amount]) => ({
          accountId,
          debit: amount,
          description: `Bill ${bill.number}`,
        })),
        ...(bill.taxTotal.gt(0) && purchaseTax
          ? [
              {
                accountId: purchaseTax.id,
                debit: bill.taxTotal,
                description: `Purchase tax on ${bill.number}`,
              },
            ]
          : []),
        {
          accountId: payable.id,
          credit: bill.total,
          description: `Bill ${bill.number}`,
        },
      ];

      await this.ledger.postWithin(tx, organizationId, {
        date: isoDate(bill.issueDate),
        memo: `Bill ${bill.number} — ${bill.vendor.name}`,
        sourceType: JournalSourceType.BILL,
        sourceId: bill.id,
        lines: journalLines,
      });
      await tx.bill.update({
        where: { id: bill.id },
        data: { status: BillStatus.OPEN, openedAt: new Date() },
      });
      return { posted: true, number: bill.number };
    });

    if (outcome.posted) {
      const opened = await this.find(id);
      await this.audit.record('bill.open', 'Bill', id, {
        number: opened.number,
        vendor: opened.vendor.name,
        total: opened.total,
        dueDate: opened.dueDate,
      });
      await this.events.publish({
        organizationId,
        type: AgentDomainEventType.BILL_OPENED,
        entityType: 'Bill',
        entityId: opened.id,
        data: {
          billId: opened.id,
          number: opened.number,
          vendorId: opened.vendorId,
          vendorName: opened.vendor.name,
          total: opened.total,
          balanceDue: opened.balanceDue,
          issueDate: opened.issueDate,
          dueDate: opened.dueDate,
        },
      });
    }
    return this.find(id);
  }

  private async findRow(id: string): Promise<BillRow> {
    const row = await this.scoped.findById<BillRow>('bill', id, { include: BILL_INCLUDE });
    if (!row) {
      throw new NotFoundException('Bill not found');
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

  private async resolveLines(input: BillLineDto[]): Promise<ComputedLine[]> {
    const ids = [...new Set(input.map((line) => line.expenseAccountId))];
    const accounts = await this.scoped.findMany<{
      id: string;
      type: string;
      active: boolean;
    }>('account', {
      where: { id: { in: ids } },
      select: { id: true, type: true, active: true },
    });
    const byId = new Map(accounts.map((account) => [account.id, account]));

    return input.map((line) => {
      const account = byId.get(line.expenseAccountId);
      if (!account) {
        throw new BadRequestException('Every line must use an account in this organization');
      }
      if (account.type !== 'EXPENSE') {
        throw new BadRequestException('Every bill line must use an expense account');
      }
      if (!account.active) {
        throw new BadRequestException('Bill lines cannot use an inactive account');
      }
      const quantity = new Prisma.Decimal(line.quantity);
      const unitPrice = new Prisma.Decimal(line.unitPrice);
      return {
        description: line.description.trim(),
        quantity,
        unitPrice,
        amount: quantity.mul(unitPrice).toDecimalPlaces(2),
        expenseAccountId: account.id,
      };
    });
  }

  private async resolveTaxRate(input: number | undefined): Promise<Prisma.Decimal> {
    if (input !== undefined) {
      return new Prisma.Decimal(input);
    }
    const { organizationId } = await this.tenant.get();
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { defaultTaxRate: true },
    });
    return organization.defaultTaxRate;
  }

  private computeTotals(
    lines: ComputedLine[],
    taxRate: Prisma.Decimal,
  ): { subtotal: Prisma.Decimal; taxTotal: Prisma.Decimal; total: Prisma.Decimal } {
    const subtotal = lines.reduce(
      (sum, line) => sum.plus(line.amount),
      new Prisma.Decimal(0),
    );
    const taxTotal = subtotal.mul(taxRate).toDecimalPlaces(2);
    return { subtotal, taxTotal, total: subtotal.plus(taxTotal) };
  }

  private assertDates(issueDate: Date, dueDate: Date): void {
    if (dueDate < issueDate) {
      throw new BadRequestException('Due date cannot be before the issue date');
    }
  }

  private async nextNumber(): Promise<string> {
    const rows = await this.scoped.findMany<{ number: string }>('bill', {
      where: { number: { startsWith: 'BILL-' } },
      orderBy: { number: 'desc' },
      take: 1,
    });
    const last = Number.parseInt(rows[0]?.number.slice('BILL-'.length) ?? '0', 10);
    const next = Number.isFinite(last) ? last + 1 : 1;
    return `BILL-${String(next).padStart(4, '0')}`;
  }

  private toView(row: BillRow, today = todayIso()): BillView {
    const total = toNumber(row.total);
    const amountPaid = toNumber(row.amountPaid);
    const status = displayStatus(row, today);
    const daysOverdue =
      status === 'OVERDUE' ? Math.max(0, dayNumber(today) - dayNumber(isoDate(row.dueDate))) : 0;

    return {
      id: row.id,
      number: row.number,
      status,
      vendorId: row.vendorId,
      vendor: {
        id: row.vendor.id,
        code: row.vendor.code,
        name: row.vendor.name,
        contactName: row.vendor.contactName,
        email: row.vendor.email,
        phone: row.vendor.phone,
        addressLine1: row.vendor.addressLine1,
        addressLine2: row.vendor.addressLine2,
        city: row.vendor.city,
        region: row.vendor.region,
        postalCode: row.vendor.postalCode,
        country: row.vendor.country,
      },
      issueDate: isoDate(row.issueDate),
      dueDate: isoDate(row.dueDate),
      openedAt: row.openedAt?.toISOString() ?? null,
      paidAt: row.paidAt?.toISOString() ?? null,
      taxRate: Number(row.taxRate.toString()),
      subtotal: toNumber(row.subtotal),
      taxTotal: toNumber(row.taxTotal),
      total,
      amountPaid,
      balanceDue: Number((total - amountPaid).toFixed(2)),
      daysOverdue,
      notes: row.notes,
      lines: row.lines.map((line) => ({
        id: line.id,
        description: line.description,
        quantity: toNumber(line.quantity),
        unitPrice: toNumber(line.unitPrice),
        amount: toNumber(line.amount),
        expenseAccountId: line.expenseAccountId,
        expenseAccount: line.expenseAccount,
      })),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
