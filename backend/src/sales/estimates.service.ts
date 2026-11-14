import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Customer, EstimateStatus, Prisma } from '@prisma/client';
import { toDate, toNumber } from '../ledger/ledger-engine';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../tenant/audit.service';
import { ScopedDataAccess } from '../tenant/scoped-data-access.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { InvoicesService } from './invoices.service';
import {
  CreateEstimateDto,
  EstimateLineDto,
  ListEstimatesDto,
  UpdateEstimateDto,
  UpdateEstimateStatusDto,
} from './estimate.dto';

type ItemWithAccount = Prisma.ItemGetPayload<{
  include: { incomeAccount: { select: { id: true; code: true; name: true } } };
}>;

const ESTIMATE_INCLUDE = {
  customer: true,
  convertedInvoice: { select: { id: true, number: true, status: true } },
  lines: {
    orderBy: { position: 'asc' },
    include: {
      item: { select: { id: true, code: true, name: true } },
      incomeAccount: { select: { id: true, code: true, name: true } },
    },
  },
} as const;

type EstimateRow = Prisma.EstimateGetPayload<{ include: typeof ESTIMATE_INCLUDE }>;

export interface EstimateLineView {
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

export interface EstimateView {
  id: string;
  number: string;
  status: EstimateStatus;
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
  expiryDate: string | null;
  taxRate: number;
  subtotal: number;
  taxTotal: number;
  total: number;
  notes: string | null;
  convertedInvoice: { id: string; number: string; status: string } | null;
  lines: EstimateLineView[];
  createdAt: string;
  updatedAt: string;
}

interface ComputedLine {
  itemId: string;
  description: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  amount: Prisma.Decimal;
  taxable: boolean;
  incomeAccountId: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function computeTotals(lines: ComputedLine[], taxRate: Prisma.Decimal) {
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
export class EstimatesService {
  constructor(
    private readonly scoped: ScopedDataAccess,
    private readonly tenant: TenantContextService,
    private readonly prisma: PrismaService,
    private readonly invoices: InvoicesService,
    private readonly audit: AuditService,
  ) {}

  async list(filters: ListEstimatesDto): Promise<EstimateView[]> {
    const where: Record<string, unknown> = {};
    if (filters.status) where.status = filters.status;
    if (filters.customerId) where.customerId = filters.customerId;
    const search = filters.search?.trim();
    if (search) {
      where.OR = [
        { number: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }
    const rows = await this.scoped.findMany<EstimateRow>('estimate', {
      where,
      orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
      take: 250,
      include: ESTIMATE_INCLUDE,
    });
    return rows.map((row) => this.toView(row));
  }

  async find(id: string): Promise<EstimateView> {
    return this.toView(await this.findRow(id));
  }

  async create(input: CreateEstimateDto): Promise<EstimateView> {
    const { organizationId } = await this.tenant.get();
    const customer = await this.resolveCustomer(input.customerId);
    const computed = await this.resolveLines(input.lines);
    const taxRate = await this.resolveTaxRate(input.taxRate);
    const issueDate = toDate(input.issueDate ?? todayIso(), 'issueDate');
    const expiryDate = input.expiryDate ? toDate(input.expiryDate, 'expiryDate') : null;
    this.assertDates(issueDate, expiryDate);
    const totals = computeTotals(computed, taxRate);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const estimate = await this.scoped.create<EstimateRow>('estimate', {
          number: await this.nextNumber(),
          customerId: customer.id,
          status: EstimateStatus.DRAFT,
          issueDate,
          expiryDate,
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
        await this.audit.record('estimate.create', 'Estimate', estimate.id, {
          number: estimate.number,
          customerId: customer.id,
          customer: customer.name,
          total: toNumber(totals.total),
        });
        return this.find(estimate.id);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          continue;
        }
        throw error;
      }
    }
    throw new ConflictException('Could not allocate an estimate number; try again');
  }

  async update(id: string, input: UpdateEstimateDto): Promise<EstimateView> {
    const { organizationId } = await this.tenant.get();
    const current = await this.findRow(id);
    if (current.status !== EstimateStatus.DRAFT) {
      throw new BadRequestException('Only draft estimates can be edited');
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
    const expiryDate =
      input.expiryDate !== undefined
        ? input.expiryDate
          ? toDate(input.expiryDate, 'expiryDate')
          : null
        : current.expiryDate;
    this.assertDates(issueDate, expiryDate);
    const totals = computeTotals(computed, taxRate);
    const notes = input.notes !== undefined ? input.notes.trim() || null : current.notes;

    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.estimate.updateMany({
        where: { id, organizationId, status: EstimateStatus.DRAFT },
        data: { customerId, issueDate, expiryDate, taxRate, ...totals, notes },
      });
      if (changed.count === 0) {
        throw new BadRequestException('Only draft estimates can be edited');
      }
      await tx.estimateLine.deleteMany({ where: { organizationId, estimateId: id } });
      await tx.estimateLine.createMany({
        data: computed.map((line, index) => ({
          organizationId,
          estimateId: id,
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

    await this.audit.record('estimate.update', 'Estimate', id, {
      number: current.number,
      customerId,
      customer: customer.name,
      total: toNumber(totals.total),
      lines: computed.length,
    });
    return this.find(id);
  }

  async changeStatus(id: string, input: UpdateEstimateStatusDto): Promise<EstimateView> {
    const current = await this.findRow(id);
    if (current.convertedInvoiceId) {
      throw new ConflictException(
        `Estimate ${current.number} was already converted to ${current.convertedInvoice?.number}.`,
      );
    }
    if (current.status === EstimateStatus.ACCEPTED || current.status === EstimateStatus.DECLINED) {
      throw new BadRequestException('This estimate is already closed');
    }
    if (current.status === EstimateStatus.DRAFT && input.status === 'DECLINED') {
      throw new BadRequestException('Send the estimate before marking it declined');
    }

    const changed = await this.scoped.updateMany(
      'estimate',
      { id, status: current.status, convertedInvoiceId: null },
      { status: input.status },
    );
    if (changed === 0) {
      throw new ConflictException('This estimate changed; refresh and try again');
    }
    await this.audit.record('estimate.status', 'Estimate', id, {
      number: current.number,
      from: current.status,
      to: input.status,
    });
    return this.find(id);
  }

  async convert(id: string): Promise<EstimateView> {
    const { organizationId } = await this.tenant.get();
    let outcome:
      | {
          invoiceId: string;
          invoiceNumber: string;
          invoiceTotal: Prisma.Decimal;
          customerId: string;
          customerName: string;
          estimateNumber: string;
        }
      | undefined;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        outcome = await this.prisma.$transaction(async (tx) => {
          const current = await tx.estimate.findFirst({
            where: { id, organizationId },
            include: {
              customer: true,
              convertedInvoice: { select: { id: true, number: true } },
              lines: { orderBy: { position: 'asc' } },
            },
          });
          if (!current) {
            throw new NotFoundException('Estimate not found');
          }
          if (current.convertedInvoice) {
            throw new ConflictException(
              `Estimate ${current.number} was already converted to ${current.convertedInvoice.number}.`,
            );
          }
          if (current.status !== EstimateStatus.ACCEPTED) {
            throw new BadRequestException('Only accepted estimates can be converted');
          }

          const issueDate = toDate(todayIso(), 'issueDate');
          const invoice = await this.invoices.createDraftWithin(tx, organizationId, {
            customerId: current.customerId,
            issueDate,
            dueDate: addDays(issueDate, 30),
            taxRate: current.taxRate,
            notes: current.notes,
            lines: current.lines.map((line) => ({
              itemId: line.itemId,
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              amount: line.amount,
              taxable: line.taxable,
              incomeAccountId: line.incomeAccountId,
            })),
          });
          const claimed = await tx.estimate.updateMany({
            where: { id, organizationId, convertedInvoiceId: null },
            data: { convertedInvoiceId: invoice.id },
          });
          if (claimed.count === 0) {
            throw new ConflictException(
              `Estimate ${current.number} has already been converted to an invoice.`,
            );
          }
          return {
            invoiceId: invoice.id,
            invoiceNumber: invoice.number,
            invoiceTotal: invoice.total,
            customerId: current.customerId,
            customerName: current.customer.name,
            estimateNumber: current.number,
          };
        });
        break;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          continue;
        }
        throw error;
      }
    }
    if (!outcome) {
      throw new ConflictException('Could not convert the estimate; try again');
    }

    await this.audit.record('invoice.create', 'Invoice', outcome.invoiceId, {
      number: outcome.invoiceNumber,
      customerId: outcome.customerId,
      customer: outcome.customerName,
      total: toNumber(outcome.invoiceTotal),
      sourceEstimateId: id,
      sourceEstimateNumber: outcome.estimateNumber,
    });
    await this.audit.record('estimate.convert', 'Estimate', id, {
      number: outcome.estimateNumber,
      invoiceId: outcome.invoiceId,
      invoiceNumber: outcome.invoiceNumber,
    });
    return this.find(id);
  }

  private async findRow(id: string): Promise<EstimateRow> {
    const row = await this.scoped.findById<EstimateRow>('estimate', id, {
      include: ESTIMATE_INCLUDE,
    });
    if (!row) {
      throw new NotFoundException('Estimate not found');
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

  private async resolveLines(input: EstimateLineDto[]): Promise<ComputedLine[]> {
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

  private assertDates(issueDate: Date, expiryDate: Date | null): void {
    if (expiryDate && expiryDate < issueDate) {
      throw new BadRequestException('Expiry date cannot be before the issue date');
    }
  }

  private async nextNumber(): Promise<string> {
    const rows = await this.scoped.findMany<{ number: string }>('estimate', {
      where: { number: { startsWith: 'EST-' } },
      orderBy: { number: 'desc' },
      take: 1,
    });
    const last = Number.parseInt(rows[0]?.number.slice('EST-'.length) ?? '0', 10);
    const next = Number.isFinite(last) ? last + 1 : 1;
    return `EST-${String(next).padStart(4, '0')}`;
  }

  private toView(row: EstimateRow): EstimateView {
    return {
      id: row.id,
      number: row.number,
      status: row.status,
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
      expiryDate: row.expiryDate ? isoDate(row.expiryDate) : null,
      taxRate: Number(row.taxRate.toString()),
      subtotal: toNumber(row.subtotal),
      taxTotal: toNumber(row.taxTotal),
      total: toNumber(row.total),
      notes: row.notes,
      convertedInvoice: row.convertedInvoice,
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
