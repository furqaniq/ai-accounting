import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus, Prisma, Project } from '@prisma/client';
import { toDate, toNumber } from '../ledger/ledger-engine';
import { PrismaService } from '../prisma/prisma.service';
import { InvoicesService } from '../sales/invoices.service';
import { AuditService } from '../tenant/audit.service';
import { ScopedDataAccess } from '../tenant/scoped-data-access.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import {
  CreateProjectDto,
  ListProjectsDto,
  UpdateProjectDto,
} from './project.dto';
import {
  CreateTimeEntryDto,
  ListTimeEntriesDto,
  RollupTimeEntriesDto,
  UpdateTimeEntryDto,
} from './time-entry.dto';

const PROJECT_INCLUDE = {
  customer: { select: { id: true, code: true, name: true } },
  billingItem: { select: { id: true, code: true, name: true } },
} as const;

const TIME_INCLUDE = {
  project: { select: { id: true, code: true, name: true } },
  user: { select: { id: true, name: true, email: true } },
  invoiceLine: {
    select: {
      id: true,
      invoice: { select: { id: true, number: true, status: true } },
    },
  },
} as const;

const ROLLUP_INCLUDE = {
  project: {
    include: {
      customer: { select: { id: true, code: true, name: true, active: true } },
      billingItem: {
        include: {
          incomeAccount: { select: { id: true, code: true, name: true, active: true } },
        },
      },
    },
  },
} as const;

type ProjectRow = Prisma.ProjectGetPayload<{ include: typeof PROJECT_INCLUDE }>;
type TimeEntryRow = Prisma.TimeEntryGetPayload<{ include: typeof TIME_INCLUDE }>;
type RollupTimeEntry = Prisma.TimeEntryGetPayload<{ include: typeof ROLLUP_INCLUDE }>;

export interface ProjectProfitability {
  revenue: number;
  expenses: number;
  profit: number;
  margin: number | null;
  totalHours: number;
  billableHours: number;
  invoicedHours: number;
  unbilledHours: number;
  nonBillableHours: number;
  billableValue: number;
  invoicedValue: number;
  unbilledValue: number;
  nonBillableValue: number;
  invoiceCount: number;
  expenseCount: number;
  timeEntryCount: number;
}

export interface ProjectView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  customerId: string | null;
  customer: { id: string; code: string; name: string } | null;
  billingItemId: string | null;
  billingItem: { id: string; code: string; name: string } | null;
  defaultRate: number | null;
  active: boolean;
  profitability: ProjectProfitability;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectInvoiceSource {
  id: string;
  number: string;
  status: InvoiceStatus;
  issueDate: string;
  dueDate: string;
  subtotal: number;
  total: number;
}

export interface ProjectExpenseSource {
  id: string;
  number: string;
  date: string;
  amount: number;
  categoryAccount: { id: string; code: string; name: string };
}

export interface TimeEntryInvoiceLink {
  id: string;
  number: string;
  status: InvoiceStatus;
  lineId: string;
}

export interface TimeEntryView {
  id: string;
  date: string;
  projectId: string | null;
  project: { id: string; code: string; name: string } | null;
  userId: string;
  user: { id: string; name: string; email: string };
  hours: number;
  rate: number;
  amount: number;
  billable: boolean;
  notes: string | null;
  invoice: TimeEntryInvoiceLink | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDetail {
  project: ProjectView;
  invoices: ProjectInvoiceSource[];
  expenses: ProjectExpenseSource[];
  timeEntries: TimeEntryView[];
}

interface ProfitAccumulator {
  revenue: Prisma.Decimal;
  expenses: Prisma.Decimal;
  totalHours: Prisma.Decimal;
  billableHours: Prisma.Decimal;
  invoicedHours: Prisma.Decimal;
  unbilledHours: Prisma.Decimal;
  billableValue: Prisma.Decimal;
  invoicedValue: Prisma.Decimal;
  unbilledValue: Prisma.Decimal;
  nonBillableValue: Prisma.Decimal;
  invoiceCount: number;
  expenseCount: number;
  timeEntryCount: number;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function blankAccumulator(): ProfitAccumulator {
  const zero = new Prisma.Decimal(0);
  return {
    revenue: zero,
    expenses: zero,
    totalHours: zero,
    billableHours: zero,
    invoicedHours: zero,
    unbilledHours: zero,
    billableValue: zero,
    invoicedValue: zero,
    unbilledValue: zero,
    nonBillableValue: zero,
    invoiceCount: 0,
    expenseCount: 0,
    timeEntryCount: 0,
  };
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly scoped: ScopedDataAccess,
    private readonly tenant: TenantContextService,
    private readonly prisma: PrismaService,
    private readonly invoices: InvoicesService,
    private readonly audit: AuditService,
  ) {}

  async list(filters: ListProjectsDto): Promise<ProjectView[]> {
    const where: Record<string, unknown> = {};
    if (filters.active !== undefined) where.active = filters.active;
    if (filters.customerId) where.customerId = filters.customerId;
    const search = filters.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const rows = await this.scoped.findMany<ProjectRow>('project', {
      where,
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: PROJECT_INCLUDE,
    });
    const profitability = await this.profitabilityFor(rows.map((row) => row.id));
    return rows.map((row) =>
      this.toView(row, profitability.get(row.id) ?? blankAccumulator()),
    );
  }

  async find(id: string): Promise<ProjectDetail> {
    const row = await this.findRow(id);
    const profitability = await this.profitabilityFor([row.id]);
    const [invoices, expenses, timeEntries] = await Promise.all([
      this.scoped.findMany<{
        id: string;
        number: string;
        status: InvoiceStatus;
        issueDate: Date;
        dueDate: Date;
        subtotal: Prisma.Decimal;
        total: Prisma.Decimal;
      }>('invoice', {
        where: { projectId: id },
        orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          number: true,
          status: true,
          issueDate: true,
          dueDate: true,
          subtotal: true,
          total: true,
        },
      }),
      this.scoped.findMany<{
        id: string;
        number: string;
        date: Date;
        amount: Prisma.Decimal;
        categoryAccount: { id: string; code: string; name: string };
      }>('expense', {
        where: { projectId: id },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          number: true,
          date: true,
          amount: true,
          categoryAccount: { select: { id: true, code: true, name: true } },
        },
      }),
      this.listTimeEntries({ projectId: id }),
    ]);

    return {
      project: this.toView(row, profitability.get(row.id) ?? blankAccumulator()),
      invoices: invoices.map((invoice) => ({
        id: invoice.id,
        number: invoice.number,
        status: invoice.status,
        issueDate: isoDate(invoice.issueDate),
        dueDate: isoDate(invoice.dueDate),
        subtotal: toNumber(invoice.subtotal),
        total: toNumber(invoice.total),
      })),
      expenses: expenses.map((expense) => ({
        id: expense.id,
        number: expense.number,
        date: isoDate(expense.date),
        amount: toNumber(expense.amount),
        categoryAccount: expense.categoryAccount,
      })),
      timeEntries,
    };
  }

  async create(input: CreateProjectDto): Promise<ProjectView> {
    const customerId = await this.resolveCustomerId(input.customerId);
    const billingItemId = await this.resolveBillingItemId(input.billingItemId);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const project = await this.scoped.create<Project>('project', {
          code: await this.nextCode(),
          name: input.name.trim(),
          description: input.description?.trim() || null,
          customerId,
          billingItemId,
          defaultRate:
            input.defaultRate !== undefined && input.defaultRate !== null
              ? new Prisma.Decimal(input.defaultRate)
              : null,
          active: input.active ?? true,
        });
        await this.audit.record('project.create', 'Project', project.id, {
          code: project.code,
          name: project.name,
          customerId,
          billingItemId,
          defaultRate: project.defaultRate?.toString() ?? null,
        });
        return this.view(project.id);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          continue;
        }
        throw error;
      }
    }
    throw new ConflictException('Could not allocate a project code; try again');
  }

  async update(id: string, input: UpdateProjectDto): Promise<ProjectView> {
    const current = await this.findRow(id);
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.description !== undefined) {
      data.description = input.description.trim() || null;
    }
    if (input.customerId !== undefined) {
      data.customerId = await this.resolveCustomerId(input.customerId);
    }
    if (input.billingItemId !== undefined) {
      data.billingItemId = await this.resolveBillingItemId(input.billingItemId);
    }
    if (input.defaultRate !== undefined) {
      data.defaultRate =
        input.defaultRate === null ? null : new Prisma.Decimal(input.defaultRate);
    }
    if (input.active !== undefined) data.active = input.active;

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [field, next] of Object.entries(data)) {
      const previous = current[field as keyof ProjectRow];
      const from = previous instanceof Prisma.Decimal ? previous.toString() : previous;
      const to = next instanceof Prisma.Decimal ? next.toString() : next;
      if (from !== to) changes[field] = { from, to };
    }

    if (Object.keys(changes).length === 0) {
      return this.view(id);
    }

    const updated = await this.scoped.updateById<Project>('project', id, data);
    if (!updated) {
      throw new NotFoundException('Project not found');
    }
    await this.audit.record('project.update', 'Project', id, { changes });
    return this.view(id);
  }

  async listTimeEntries(filters: ListTimeEntriesDto): Promise<TimeEntryView[]> {
    const where: Record<string, unknown> = {};
    if (filters.projectId) where.projectId = filters.projectId;
    if (filters.billable !== undefined) where.billable = filters.billable;
    if (filters.invoiced === true) where.invoiceLineId = { not: null };
    if (filters.invoiced === false) where.invoiceLineId = null;
    const date: Record<string, Date> = {};
    if (filters.from) date.gte = toDate(filters.from, 'from');
    if (filters.to) date.lte = toDate(filters.to, 'to');
    if (Object.keys(date).length > 0) where.date = date;

    const rows = await this.scoped.findMany<TimeEntryRow>('timeEntry', {
      where,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 500,
      include: TIME_INCLUDE,
    });
    return rows.map((row) => this.toTimeView(row));
  }

  async createTimeEntry(input: CreateTimeEntryDto): Promise<TimeEntryView> {
    const { organizationId } = await this.tenant.get();
    const userId = this.tenant.userId();
    if (!userId) {
      throw new BadRequestException('A signed-in member is required');
    }
    const project = input.projectId
      ? await this.resolveProject(input.projectId)
      : null;
    const rate =
      input.rate !== undefined
        ? new Prisma.Decimal(input.rate)
        : project?.defaultRate;
    if (rate === null || rate === undefined) {
      throw new BadRequestException(
        'Enter a rate or set a default rate on the project',
      );
    }
    const entry = await this.scoped.create<TimeEntryRow>('timeEntry', {
      organizationId,
      projectId: project?.id ?? null,
      userId,
      date: toDate(input.date ?? todayIso(), 'date'),
      hours: new Prisma.Decimal(input.hours),
      rate,
      billable: input.billable ?? true,
      notes: input.notes?.trim() || null,
    });
    await this.audit.record('time_entry.create', 'TimeEntry', entry.id, {
      projectId: project?.id ?? null,
      project: project?.name ?? null,
      date: isoDate(entry.date),
      hours: entry.hours.toString(),
      rate: entry.rate.toString(),
      billable: entry.billable,
    });
    return this.timeView(entry.id);
  }

  async updateTimeEntry(id: string, input: UpdateTimeEntryDto): Promise<TimeEntryView> {
    const current = await this.findTimeRow(id);
    if (current.invoiceLineId) {
      throw new BadRequestException('Invoiced time cannot be edited');
    }

    const data: Record<string, unknown> = {};
    if (input.date !== undefined) data.date = toDate(input.date, 'date');
    if (input.hours !== undefined) data.hours = new Prisma.Decimal(input.hours);
    if (input.rate !== undefined) data.rate = new Prisma.Decimal(input.rate);
    if (input.billable !== undefined) data.billable = input.billable;
    if (input.projectId !== undefined) {
      data.projectId = input.projectId
        ? (await this.resolveProject(input.projectId)).id
        : null;
    }
    if (input.notes !== undefined) data.notes = input.notes.trim() || null;

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [field, next] of Object.entries(data)) {
      const previous = current[field as keyof TimeEntryRow];
      const from = previous instanceof Date
        ? isoDate(previous)
        : previous instanceof Prisma.Decimal
          ? previous.toString()
          : previous;
      const to = next instanceof Date
        ? isoDate(next)
        : next instanceof Prisma.Decimal
          ? next.toString()
          : next;
      if (from !== to) changes[field] = { from, to };
    }

    if (Object.keys(changes).length === 0) {
      return this.toTimeView(current);
    }

    const updated = await this.scoped.updateById<TimeEntryRow>('timeEntry', id, data);
    if (!updated) {
      throw new NotFoundException('Time entry not found');
    }
    await this.audit.record('time_entry.update', 'TimeEntry', id, { changes });
    return this.timeView(id);
  }

  async deleteTimeEntry(id: string): Promise<void> {
    const current = await this.findTimeRow(id);
    if (current.invoiceLineId) {
      throw new BadRequestException('Invoiced time cannot be deleted');
    }
    const deleted = await this.scoped.deleteById('timeEntry', id);
    if (!deleted) {
      throw new NotFoundException('Time entry not found');
    }
    await this.audit.record('time_entry.delete', 'TimeEntry', id, {
      projectId: current.projectId,
      project: current.project?.name ?? null,
      date: isoDate(current.date),
      hours: current.hours.toString(),
      rate: current.rate.toString(),
    });
  }

  async rollup(input: RollupTimeEntriesDto): Promise<{
    invoice: Awaited<ReturnType<InvoicesService['find']>>;
    linkedEntryIds: string[];
  }> {
    const { organizationId } = await this.tenant.get();
    const entryIds = [...new Set(input.entryIds)];

    const outcome = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM "TimeEntry"
        WHERE "organizationId" = ${organizationId}
          AND id IN (${Prisma.join(entryIds)})
        FOR UPDATE
      `);
      if (locked.length !== entryIds.length) {
        throw new NotFoundException('One or more time entries were not found');
      }

      const entries = await tx.timeEntry.findMany({
        where: { organizationId, id: { in: entryIds } },
        include: ROLLUP_INCLUDE,
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      });
      if (entries.length !== entryIds.length) {
        throw new NotFoundException('One or more time entries were not found');
      }

      const projectIds = new Set(entries.map((entry) => entry.projectId));
      if (projectIds.size !== 1 || !entries[0].project) {
        throw new BadRequestException('Select time entries from one project');
      }
      const project = entries[0].project;
      if (entries.some((entry) => !entry.billable)) {
        throw new BadRequestException('Only billable time can be rolled up');
      }
      if (entries.some((entry) => entry.invoiceLineId)) {
        throw new BadRequestException('One or more time entries are already invoiced');
      }

      const customerId = input.customerId || project.customerId;
      if (!customerId) {
        throw new BadRequestException(
          'Choose a customer or set one on the project before billing time',
        );
      }
      const customer = await tx.customer.findFirst({
        where: { id: customerId, organizationId },
        select: { id: true, name: true, active: true },
      });
      if (!customer) {
        throw new BadRequestException('Customer must belong to this organization');
      }
      if (!customer.active) {
        throw new BadRequestException('Customer is inactive');
      }

      const billingItemId = input.billingItemId || project.billingItemId;
      if (!billingItemId) {
        throw new BadRequestException(
          'Choose a billing item or set one on the project before billing time',
        );
      }
      const item = await tx.item.findFirst({
        where: { id: billingItemId, organizationId },
        select: {
          id: true,
          code: true,
          name: true,
          active: true,
          taxable: true,
          incomeAccountId: true,
        },
      });
      if (!item) {
        throw new BadRequestException('Billing item must belong to this organization');
      }
      if (!item.active) {
        throw new BadRequestException('Billing item is inactive');
      }

      const issueDateIso = input.issueDate ?? todayIso();
      const issueDate = toDate(issueDateIso, 'issueDate');
      const dueDate = toDate(
        input.dueDate ?? addDays(issueDateIso, 30),
        'dueDate',
      );
      if (dueDate < issueDate) {
        throw new BadRequestException('Due date cannot be before the issue date');
      }
      const taxRate =
        input.taxRate !== undefined
          ? new Prisma.Decimal(input.taxRate)
          : (
              await tx.organization.findUniqueOrThrow({
                where: { id: organizationId },
                select: { defaultTaxRate: true },
              })
            ).defaultTaxRate;

      const lines = entries.map((entry) => ({
        itemId: item.id,
        description: this.timeLineDescription(entry, project.name),
        quantity: entry.hours,
        unitPrice: entry.rate,
        amount: entry.hours.mul(entry.rate).toDecimalPlaces(2),
        taxable: item.taxable,
        incomeAccountId: item.incomeAccountId,
      }));

      const invoice = await this.invoices.createDraftWithin(tx, organizationId, {
        customerId,
        projectId: project.id,
        issueDate,
        dueDate,
        taxRate,
        notes: input.notes?.trim() || null,
        lines,
      });
      const invoiceLines = await tx.invoiceLine.findMany({
        where: { organizationId, invoiceId: invoice.id },
        orderBy: { position: 'asc' },
        select: { id: true },
      });
      for (let index = 0; index < entries.length; index += 1) {
        await tx.timeEntry.update({
          where: { id: entries[index].id },
          data: { invoiceLineId: invoiceLines[index].id },
        });
      }

      return {
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        projectId: project.id,
        projectName: project.name,
        entryIds: entries.map((entry) => entry.id),
        total: invoice.total,
      };
    });

    await this.audit.record('time_entry.rollup', 'Invoice', outcome.invoiceId, {
      number: outcome.invoiceNumber,
      projectId: outcome.projectId,
      project: outcome.projectName,
      entries: outcome.entryIds.length,
      total: toNumber(outcome.total),
    });

    return {
      invoice: await this.invoices.find(outcome.invoiceId),
      linkedEntryIds: outcome.entryIds,
    };
  }

  private async profitabilityFor(
    projectIds: string[],
  ): Promise<Map<string, ProfitAccumulator>> {
    const result = new Map<string, ProfitAccumulator>();
    for (const id of projectIds) result.set(id, blankAccumulator());
    if (projectIds.length === 0) return result;

    const [invoices, expenses, timeEntries] = await Promise.all([
      this.scoped.findMany<{
        projectId: string | null;
        subtotal: Prisma.Decimal;
      }>('invoice', {
        where: {
          projectId: { in: projectIds },
          status: { not: InvoiceStatus.DRAFT },
        },
        select: { projectId: true, subtotal: true },
      }),
      this.scoped.findMany<{
        projectId: string | null;
        amount: Prisma.Decimal;
      }>('expense', {
        where: { projectId: { in: projectIds } },
        select: { projectId: true, amount: true },
      }),
      this.scoped.findMany<{
        projectId: string | null;
        hours: Prisma.Decimal;
        rate: Prisma.Decimal;
        billable: boolean;
        invoiceLineId: string | null;
      }>('timeEntry', {
        where: { projectId: { in: projectIds } },
        select: {
          projectId: true,
          hours: true,
          rate: true,
          billable: true,
          invoiceLineId: true,
        },
      }),
    ]);

    for (const invoice of invoices) {
      if (!invoice.projectId) continue;
      const stats = result.get(invoice.projectId);
      if (!stats) continue;
      stats.revenue = stats.revenue.plus(invoice.subtotal);
      stats.invoiceCount += 1;
    }
    for (const expense of expenses) {
      if (!expense.projectId) continue;
      const stats = result.get(expense.projectId);
      if (!stats) continue;
      stats.expenses = stats.expenses.plus(expense.amount);
      stats.expenseCount += 1;
    }
    for (const entry of timeEntries) {
      if (!entry.projectId) continue;
      const stats = result.get(entry.projectId);
      if (!stats) continue;
      const amount = entry.hours.mul(entry.rate);
      stats.totalHours = stats.totalHours.plus(entry.hours);
      stats.timeEntryCount += 1;
      if (entry.billable) {
        stats.billableHours = stats.billableHours.plus(entry.hours);
        stats.billableValue = stats.billableValue.plus(amount);
        if (entry.invoiceLineId) {
          stats.invoicedHours = stats.invoicedHours.plus(entry.hours);
          stats.invoicedValue = stats.invoicedValue.plus(amount);
        } else {
          stats.unbilledHours = stats.unbilledHours.plus(entry.hours);
          stats.unbilledValue = stats.unbilledValue.plus(amount);
        }
      } else {
        stats.nonBillableValue = stats.nonBillableValue.plus(amount);
      }
    }

    return result;
  }

  private toView(row: ProjectRow, stats: ProfitAccumulator): ProjectView {
    const revenue = toNumber(stats.revenue);
    const expenses = toNumber(stats.expenses);
    const profit = toNumber(stats.revenue.minus(stats.expenses));
    const nonBillableHours = toNumber(stats.totalHours.minus(stats.billableHours));
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      customerId: row.customerId,
      customer: row.customer,
      billingItemId: row.billingItemId,
      billingItem: row.billingItem,
      defaultRate: row.defaultRate === null ? null : toNumber(row.defaultRate),
      active: row.active,
      profitability: {
        revenue,
        expenses,
        profit,
        margin: revenue > 0 ? Number((profit / revenue).toFixed(4)) : null,
        totalHours: toNumber(stats.totalHours),
        billableHours: toNumber(stats.billableHours),
        invoicedHours: toNumber(stats.invoicedHours),
        unbilledHours: toNumber(stats.unbilledHours),
        nonBillableHours,
        billableValue: toNumber(stats.billableValue),
        invoicedValue: toNumber(stats.invoicedValue),
        unbilledValue: toNumber(stats.unbilledValue),
        nonBillableValue: toNumber(stats.nonBillableValue),
        invoiceCount: stats.invoiceCount,
        expenseCount: stats.expenseCount,
        timeEntryCount: stats.timeEntryCount,
      },
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toTimeView(row: TimeEntryRow): TimeEntryView {
    return {
      id: row.id,
      date: isoDate(row.date),
      projectId: row.projectId,
      project: row.project,
      userId: row.userId,
      user: row.user,
      hours: toNumber(row.hours),
      rate: toNumber(row.rate),
      amount: Number(row.hours.mul(row.rate).toFixed(2)),
      billable: row.billable,
      notes: row.notes,
      invoice: row.invoiceLine
        ? {
            id: row.invoiceLine.invoice.id,
            number: row.invoiceLine.invoice.number,
            status: row.invoiceLine.invoice.status,
            lineId: row.invoiceLine.id,
          }
        : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async view(id: string): Promise<ProjectView> {
    const row = await this.findRow(id);
    const profitability = await this.profitabilityFor([row.id]);
    return this.toView(row, profitability.get(row.id) ?? blankAccumulator());
  }

  private async findRow(id: string): Promise<ProjectRow> {
    const row = await this.scoped.findById<ProjectRow>('project', id, {
      include: PROJECT_INCLUDE,
    });
    if (!row) {
      throw new NotFoundException('Project not found');
    }
    return row;
  }

  private async timeView(id: string): Promise<TimeEntryView> {
    return this.toTimeView(await this.findTimeRow(id));
  }

  private async findTimeRow(id: string): Promise<TimeEntryRow> {
    const row = await this.scoped.findById<TimeEntryRow>('timeEntry', id, {
      include: TIME_INCLUDE,
    });
    if (!row) {
      throw new NotFoundException('Time entry not found');
    }
    return row;
  }

  private async resolveProject(projectId: string): Promise<Project> {
    const project = await this.scoped.findById<Project>('project', projectId);
    if (!project) {
      throw new BadRequestException('Project must belong to this organization');
    }
    if (!project.active) {
      throw new BadRequestException('Project is inactive');
    }
    return project;
  }

  private async resolveCustomerId(input: string | undefined): Promise<string | null> {
    if (!input) return null;
    const customer = await this.scoped.findById<{
      id: string;
      active: boolean;
    }>('customer', input, { select: { id: true, active: true } });
    if (!customer) {
      throw new BadRequestException('Customer must belong to this organization');
    }
    if (!customer.active) {
      throw new BadRequestException('Customer is inactive');
    }
    return customer.id;
  }

  private async resolveBillingItemId(input: string | undefined): Promise<string | null> {
    if (!input) return null;
    const item = await this.scoped.findById<{
      id: string;
      active: boolean;
    }>('item', input, { select: { id: true, active: true } });
    if (!item) {
      throw new BadRequestException('Billing item must belong to this organization');
    }
    if (!item.active) {
      throw new BadRequestException('Billing item is inactive');
    }
    return item.id;
  }

  private timeLineDescription(entry: RollupTimeEntry, projectName: string): string {
    const base = `Time — ${projectName} — ${isoDate(entry.date)}`;
    return entry.notes ? `${base} · ${entry.notes}` : base;
  }

  private async nextCode(): Promise<string> {
    const rows = await this.scoped.findMany<{ code: string }>('project', {
      where: { code: { startsWith: 'PROJ-' } },
      orderBy: { code: 'desc' },
      take: 1,
    });
    const last = Number.parseInt(rows[0]?.code.slice('PROJ-'.length) ?? '0', 10);
    const next = Number.isFinite(last) ? last + 1 : 1;
    return `PROJ-${String(next).padStart(4, '0')}`;
  }
}
