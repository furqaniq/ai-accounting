import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Customer, InvoiceStatus, JournalSourceType, Prisma } from '@prisma/client';
import { LedgerEngine, toDate, toNumber } from '../ledger/ledger-engine';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../tenant/audit.service';
import { ScopedDataAccess } from '../tenant/scoped-data-access.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import {
  CreateInvoiceDto,
  InvoiceLineDto,
  ListInvoicesDto,
  UpdateInvoiceDto,
} from './invoice.dto';

type ItemWithAccount = Prisma.ItemGetPayload<{
  include: { incomeAccount: { select: { id: true; code: true; name: true } } };
}>;

const INVOICE_INCLUDE = {
  customer: true,
  lines: {
    orderBy: { position: 'asc' },
    include: {
      item: { select: { id: true, code: true, name: true } },
      incomeAccount: { select: { id: true, code: true, name: true } },
    },
  },
} as const;

type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof INVOICE_INCLUDE }>;

export type InvoiceDisplayStatus = 'DRAFT' | 'SENT' | 'PARTIAL' | 'PAID' | 'OVERDUE';

export interface InvoiceLineView {
  id: string;
  itemId: string;
  item: { id: string; code: string; name: string };
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  taxable: boolean;
  incomeAccountId: string;
  incomeAccount: { id: string; code: string; name: string };
}

export interface InvoiceView {
  id: string;
  number: string;
  status: InvoiceDisplayStatus;
  customerId: string;
  customer: {
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
  sentAt: string | null;
  paidAt: string | null;
  taxRate: number;
  subtotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  daysOverdue: number;
  notes: string | null;
  lines: InvoiceLineView[];
  createdAt: string;
  updatedAt: string;
}

export interface ComputedLine {
  itemId: string;
  description: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  amount: Prisma.Decimal;
  taxable: boolean;
  incomeAccountId: string;
}

interface ComputedTotals {
  subtotal: Prisma.Decimal;
  taxTotal: Prisma.Decimal;
  total: Prisma.Decimal;
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

function displayStatus(row: InvoiceRow, today = todayIso()): InvoiceDisplayStatus {
  if (row.status === InvoiceStatus.SENT || row.status === InvoiceStatus.PARTIAL) {
    if (row.total.minus(row.amountPaid).gt(0) && isoDate(row.dueDate) < today) {
      return 'OVERDUE';
    }
  }
  return row.status;
}

function computeTotals(lines: ComputedLine[], taxRate: Prisma.Decimal): ComputedTotals {
  const subtotal = lines.reduce(
    (sum, line) => sum.plus(line.amount),
    new Prisma.Decimal(0),
  );
  const taxable = lines.reduce(
    (sum, line) => (line.taxable ? sum.plus(line.amount) : sum),
    new Prisma.Decimal(0),
  );
  const taxTotal = taxable.mul(taxRate).toDecimalPlaces(2);
  return { subtotal, taxTotal, total: subtotal.plus(taxTotal) };
}

@Injectable()
export class InvoicesService {
  constructor(
    private readonly scoped: ScopedDataAccess,
    private readonly tenant: TenantContextService,
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerEngine,
    private readonly audit: AuditService,
  ) {}

  async list(filters: ListInvoicesDto): Promise<InvoiceView[]> {
    const where: Record<string, unknown> = {};
    if (filters.customerId) where.customerId = filters.customerId;
    const search = filters.search?.trim();
    if (search) {
      where.OR = [
        { number: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const rows = await this.scoped.findMany<InvoiceRow>('invoice', {
      where,
      orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
      take: 250,
      include: INVOICE_INCLUDE,
    });
    const today = todayIso();
    const views = rows.map((row) => this.toView(row, today));
    return filters.status
      ? views.filter((invoice) => invoice.status === filters.status)
      : views;
  }

  async find(id: string): Promise<InvoiceView> {
    return this.toView(await this.findRow(id));
  }

  async create(input: CreateInvoiceDto): Promise<InvoiceView> {
    const { organizationId } = await this.tenant.get();
    const customer = await this.resolveCustomer(input.customerId);
    const computed = await this.resolveLines(input.lines);
    const taxRate = await this.resolveTaxRate(input.taxRate);
    const issueDate = toDate(input.issueDate ?? todayIso(), 'issueDate');
    const dueDate = toDate(input.dueDate, 'dueDate');
    this.assertDates(issueDate, dueDate);
    const totals = computeTotals(computed, taxRate);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const invoice = await this.scoped.create<InvoiceRow>('invoice', {
          number: await this.nextNumber(),
          customerId: customer.id,
          status: InvoiceStatus.DRAFT,
          issueDate,
          dueDate,
          taxRate,
          ...totals,
          notes: input.notes?.trim() || null,
          lines: {
            create: computed.map((line, index) => ({
              organizationId,
              position: index,
              itemId: line.itemId,
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              amount: line.amount,
              taxable: line.taxable,
              incomeAccountId: line.incomeAccountId,
            })),
          },
        });
        await this.audit.record('invoice.create', 'Invoice', invoice.id, {
          number: invoice.number,
          customerId: customer.id,
          customer: customer.name,
          total: toNumber(totals.total),
        });
        return this.find(invoice.id);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          continue;
        }
        throw error;
      }
    }
    throw new ConflictException('Could not allocate an invoice number; try again');
  }

  async update(id: string, input: UpdateInvoiceDto): Promise<InvoiceView> {
    const { organizationId } = await this.tenant.get();
    const current = await this.findRow(id);
    if (current.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException('Only draft invoices can be edited');
    }

    const customerId = input.customerId ?? current.customerId;
    const customer =
      customerId === current.customerId
        ? { id: current.customer.id, name: current.customer.name }
        : await this.resolveCustomer(customerId);

    const computed = input.lines
      ? await this.resolveLines(input.lines)
      : current.lines.map((line) => ({
          itemId: line.itemId,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          amount: line.amount,
          taxable: line.taxable,
          incomeAccountId: line.incomeAccountId,
        }));
    const taxRate =
      input.taxRate !== undefined ? new Prisma.Decimal(input.taxRate) : current.taxRate;
    const issueDate = input.issueDate
      ? toDate(input.issueDate, 'issueDate')
      : current.issueDate;
    const dueDate = input.dueDate ? toDate(input.dueDate, 'dueDate') : current.dueDate;
    this.assertDates(issueDate, dueDate);
    const totals = computeTotals(computed, taxRate);
    const notes =
      input.notes !== undefined ? input.notes.trim() || null : current.notes;

    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.invoice.updateMany({
        where: { id, organizationId, status: InvoiceStatus.DRAFT },
        data: {
          customerId,
          issueDate,
          dueDate,
          taxRate,
          ...totals,
          notes,
        },
      });
      if (changed.count === 0) {
        throw new BadRequestException('Only draft invoices can be edited');
      }
      await tx.invoiceLine.deleteMany({ where: { organizationId, invoiceId: id } });
      await tx.invoiceLine.createMany({
        data: computed.map((line, index) => ({
          organizationId,
          invoiceId: id,
          position: index,
          itemId: line.itemId,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          amount: line.amount,
          taxable: line.taxable,
          incomeAccountId: line.incomeAccountId,
        })),
      });
    });

    await this.audit.record('invoice.update', 'Invoice', id, {
      number: current.number,
      customerId,
      customer: customer.name,
      total: toNumber(totals.total),
      lines: computed.length,
    });
    return this.find(id);
  }

  async send(id: string): Promise<InvoiceView> {
    const { organizationId } = await this.tenant.get();
    const outcome = await this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: { id, organizationId },
        include: { customer: true, lines: { orderBy: { position: 'asc' } } },
      });
      if (!invoice) {
        throw new NotFoundException('Invoice not found');
      }
      if (invoice.status !== InvoiceStatus.DRAFT) {
        return { posted: false, number: invoice.number };
      }

      const [receivable, taxPayable] = await Promise.all([
        tx.account.findFirst({
          where: { organizationId, code: '1100', active: true },
          select: { id: true },
        }),
        tx.account.findFirst({
          where: { organizationId, code: '2100', active: true },
          select: { id: true },
        }),
      ]);
      if (!receivable) {
        throw new BadRequestException('An active Accounts receivable account is required');
      }
      if (invoice.taxTotal.gt(0) && !taxPayable) {
        throw new BadRequestException('An active Sales tax payable account is required');
      }

      const incomeByAccount = new Map<string, Prisma.Decimal>();
      for (const line of invoice.lines) {
        incomeByAccount.set(
          line.incomeAccountId,
          (incomeByAccount.get(line.incomeAccountId) ?? new Prisma.Decimal(0)).plus(
            line.amount,
          ),
        );
      }

      const journalLines = [
        {
          accountId: receivable.id,
          debit: invoice.total,
          description: `Invoice ${invoice.number}`,
        },
        ...[...incomeByAccount.entries()].map(([accountId, amount]) => ({
          accountId,
          credit: amount,
          description: `Invoice ${invoice.number}`,
        })),
        ...(invoice.taxTotal.gt(0) && taxPayable
          ? [
              {
                accountId: taxPayable.id,
                credit: invoice.taxTotal,
                description: `Sales tax on ${invoice.number}`,
              },
            ]
          : []),
      ];

      await this.ledger.postWithin(tx, organizationId, {
        date: isoDate(invoice.issueDate),
        memo: `Invoice ${invoice.number} — ${invoice.customer.name}`,
        sourceType: JournalSourceType.INVOICE,
        sourceId: invoice.id,
        lines: journalLines,
      });
      await tx.invoice.update({
        where: { id: invoice.id },
        data: { status: InvoiceStatus.SENT, sentAt: new Date() },
      });
      return { posted: true, number: invoice.number };
    });

    if (outcome.posted) {
      const sent = await this.find(id);
      await this.audit.record('invoice.send', 'Invoice', id, {
        number: sent.number,
        customer: sent.customer.name,
        total: sent.total,
        dueDate: sent.dueDate,
      });
    }
    return this.find(id);
  }

  async createDraftWithin(
    tx: Prisma.TransactionClient,
    organizationId: string,
    input: {
      customerId: string;
      issueDate: Date;
      dueDate: Date;
      taxRate: Prisma.Decimal;
      notes: string | null;
      lines: ComputedLine[];
    },
  ): Promise<{ id: string; number: string; customerId: string; total: Prisma.Decimal }> {
    const totals = computeTotals(input.lines, input.taxRate);
    const invoice = await tx.invoice.create({
      data: {
        organizationId,
        number: await this.nextNumber(),
        customerId: input.customerId,
        status: InvoiceStatus.DRAFT,
        issueDate: input.issueDate,
        dueDate: input.dueDate,
        taxRate: input.taxRate,
        ...totals,
        notes: input.notes,
        lines: {
          create: input.lines.map((line, index) => ({
            organizationId,
            position: index,
            itemId: line.itemId,
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            amount: line.amount,
            taxable: line.taxable,
            incomeAccountId: line.incomeAccountId,
          })),
        },
      },
      select: { id: true, number: true, customerId: true, total: true },
    });
    return invoice;
  }

  private async findRow(id: string): Promise<InvoiceRow> {
    const row = await this.scoped.findById<InvoiceRow>('invoice', id, {
      include: INVOICE_INCLUDE,
    });
    if (!row) {
      throw new NotFoundException('Invoice not found');
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

  private async resolveLines(input: InvoiceLineDto[]): Promise<ComputedLine[]> {
    const ids = [...new Set(input.map((line) => line.itemId))];
    const rows = await this.scoped.findMany<ItemWithAccount>('item', {
      where: { id: { in: ids } },
      include: { incomeAccount: { select: { id: true, code: true, name: true } } },
    });
    const items = new Map<string, ItemWithAccount>(rows.map((item) => [item.id, item]));

    return input.map((line) => {
      const item = items.get(line.itemId);
      if (!item) {
        throw new BadRequestException('Every line must reference an item in this organization');
      }
      if (!item.active) {
        throw new BadRequestException(`Item ${item.code} is inactive`);
      }
      const quantity = new Prisma.Decimal(line.quantity);
      const unitPrice = new Prisma.Decimal(line.unitPrice ?? item.price);
      return {
        itemId: item.id,
        description: line.description?.trim() || item.name,
        quantity,
        unitPrice,
        amount: quantity.mul(unitPrice).toDecimalPlaces(2),
        taxable: item.taxable,
        incomeAccountId: item.incomeAccountId,
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

  private assertDates(issueDate: Date, dueDate: Date): void {
    if (dueDate < issueDate) {
      throw new BadRequestException('Due date cannot be before the issue date');
    }
  }

  private async nextNumber(): Promise<string> {
    const rows = await this.scoped.findMany<{ number: string }>('invoice', {
      where: { number: { startsWith: 'INV-' } },
      orderBy: { number: 'desc' },
      take: 1,
    });
    const last = Number.parseInt(rows[0]?.number.slice('INV-'.length) ?? '0', 10);
    const next = Number.isFinite(last) ? last + 1 : 1;
    return `INV-${String(next).padStart(4, '0')}`;
  }

  private toView(row: InvoiceRow, today = todayIso()): InvoiceView {
    const total = toNumber(row.total);
    const amountPaid = toNumber(row.amountPaid);
    const status = displayStatus(row, today);
    const daysOverdue =
      status === 'OVERDUE' ? Math.max(0, dayNumber(today) - dayNumber(isoDate(row.dueDate))) : 0;

    return {
      id: row.id,
      number: row.number,
      status,
      customerId: row.customerId,
      customer: {
        id: row.customer.id,
        code: row.customer.code,
        name: row.customer.name,
        contactName: row.customer.contactName,
        email: row.customer.email,
        phone: row.customer.phone,
        addressLine1: row.customer.addressLine1,
        addressLine2: row.customer.addressLine2,
        city: row.customer.city,
        region: row.customer.region,
        postalCode: row.customer.postalCode,
        country: row.customer.country,
      },
      issueDate: isoDate(row.issueDate),
      dueDate: isoDate(row.dueDate),
      sentAt: row.sentAt?.toISOString() ?? null,
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
        itemId: line.itemId,
        item: line.item,
        description: line.description,
        quantity: toNumber(line.quantity),
        unitPrice: toNumber(line.unitPrice),
        amount: toNumber(line.amount),
        taxable: line.taxable,
        incomeAccountId: line.incomeAccountId,
        incomeAccount: line.incomeAccount,
      })),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
