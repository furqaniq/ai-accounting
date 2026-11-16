import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Expense, JournalSourceType, Prisma, Vendor } from '@prisma/client';
import {
  LedgerEngine,
  reverseEntry,
  toDate,
  toNumber,
} from '../ledger/ledger-engine';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../tenant/audit.service';
import { ScopedDataAccess } from '../tenant/scoped-data-access.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import {
  CreateExpenseDto,
  ListExpensesDto,
  UpdateExpenseDto,
} from './expense.dto';

const EXPENSE_INCLUDE = {
  vendor: { select: { id: true, code: true, name: true } },
  categoryAccount: { select: { id: true, code: true, name: true, type: true } },
  project: { select: { id: true, code: true, name: true } },
} as const;

type ExpenseRow = Prisma.ExpenseGetPayload<{ include: typeof EXPENSE_INCLUDE }>;
type CategoryAccount = {
  id: string;
  code: string;
  name: string;
  type: string;
  active: boolean;
};

interface PreparedExpense {
  vendor: Vendor | null;
  projectId: string | null;
  category: CategoryAccount;
  date: Date;
  amount: Prisma.Decimal;
  memo: string | null;
  receiptNote: string | null;
}

export interface ExpenseView {
  id: string;
  number: string;
  date: string;
  vendorId: string | null;
  vendor: { id: string; code: string; name: string } | null;
  projectId: string | null;
  project: { id: string; code: string; name: string } | null;
  categoryAccountId: string;
  categoryAccount: { id: string; code: string; name: string; type: string };
  amount: number;
  memo: string | null;
  receiptNote: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

@Injectable()
export class ExpensesService {
  constructor(
    private readonly scoped: ScopedDataAccess,
    private readonly tenant: TenantContextService,
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerEngine,
    private readonly audit: AuditService,
  ) {}

  async list(filters: ListExpensesDto): Promise<ExpenseView[]> {
    const where: Record<string, unknown> = {};
    const date: Record<string, Date> = {};
    if (filters.from) date.gte = toDate(filters.from, 'from');
    if (filters.to) date.lte = toDate(filters.to, 'to');
    if (Object.keys(date).length > 0) where.date = date;
    if (filters.vendorId) where.vendorId = filters.vendorId;
    if (filters.projectId) where.projectId = filters.projectId;
    if (filters.categoryAccountId) {
      where.categoryAccountId = filters.categoryAccountId;
    }

    const search = filters.search?.trim();
    if (search) {
      where.OR = [
        { number: { contains: search, mode: 'insensitive' } },
        { memo: { contains: search, mode: 'insensitive' } },
        { receiptNote: { contains: search, mode: 'insensitive' } },
        { vendor: { name: { contains: search, mode: 'insensitive' } } },
        { categoryAccount: { name: { contains: search, mode: 'insensitive' } } },
        { categoryAccount: { code: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const rows = await this.scoped.findMany<ExpenseRow>('expense', {
      where,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 250,
      include: EXPENSE_INCLUDE,
    });
    return rows.map((row) => this.toView(row));
  }

  async find(id: string): Promise<ExpenseView> {
    return this.toView(await this.findRow(id));
  }

  async create(input: CreateExpenseDto): Promise<ExpenseView> {
    const { organizationId } = await this.tenant.get();
    const prepared = await this.prepareCreate(input);
    const cash = await this.resolveCash();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const created = await this.prisma.$transaction((tx) =>
          this.createWithin(tx, organizationId, prepared, cash.id),
        );
        await this.audit.record('expense.create', 'Expense', created.id, {
          number: created.number,
          date: isoDate(created.date),
          amount: toNumber(created.amount),
          vendor: prepared.vendor?.name ?? null,
          projectId: prepared.projectId,
          category: `${prepared.category.code} ${prepared.category.name}`,
          receiptNote: created.receiptNote,
        });
        return this.toView(created);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          continue;
        }
        throw error;
      }
    }
    throw new ConflictException('Could not allocate an expense number; try again');
  }

  async createFromBankTransaction(
    tx: Prisma.TransactionClient,
    organizationId: string,
    input: CreateExpenseDto,
    fundingAccountId: string,
  ): Promise<ExpenseRow> {
    const prepared = await this.prepareCreate(input);
    return this.createWithin(tx, organizationId, prepared, fundingAccountId);
  }

  private async prepareCreate(input: CreateExpenseDto): Promise<PreparedExpense> {
    const vendor = input.vendorId ? await this.resolveVendor(input.vendorId) : null;
    const projectId = await this.resolveProjectId(input.projectId);
    const category = await this.resolveCategory(input.categoryAccountId);
    return {
      vendor,
      projectId,
      category,
      date: toDate(input.date ?? todayIso(), 'date'),
      amount: new Prisma.Decimal(input.amount),
      memo: input.memo?.trim() || null,
      receiptNote: input.receiptNote?.trim() || null,
    };
  }

  private async createWithin(
    tx: Prisma.TransactionClient,
    organizationId: string,
    prepared: PreparedExpense,
    fundingAccountId: string,
  ): Promise<ExpenseRow> {
    const number = await this.nextNumber(tx, organizationId);
    const expense = await tx.expense.create({
      data: {
        organizationId,
        number,
        date: prepared.date,
        vendorId: prepared.vendor?.id ?? null,
        projectId: prepared.projectId,
        categoryAccountId: prepared.category.id,
        amount: prepared.amount,
        memo: prepared.memo,
        receiptNote: prepared.receiptNote,
      },
      include: EXPENSE_INCLUDE,
    });
    await this.post(
      tx,
      organizationId,
      expense,
      prepared.vendor,
      prepared.category,
      fundingAccountId,
    );
    return expense;
  }

  async update(id: string, input: UpdateExpenseDto): Promise<ExpenseView> {
    const { organizationId } = await this.tenant.get();
    const outcome = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM "Expense"
        WHERE "organizationId" = ${organizationId} AND id = ${id}
        FOR UPDATE
      `);
      if (locked.length === 0) {
        throw new NotFoundException('Expense not found');
      }

      const current = await tx.expense.findFirst({
        where: { id, organizationId },
        include: EXPENSE_INCLUDE,
      });
      if (!current) {
        throw new NotFoundException('Expense not found');
      }

      const vendorId =
        input.vendorId === undefined
          ? current.vendorId
          : input.vendorId.trim() || null;
      let vendorName = current.vendor?.name ?? null;
      if (vendorId !== current.vendorId) {
        const vendor = vendorId ? await this.resolveVendor(vendorId) : null;
        vendorName = vendor?.name ?? null;
      }

      const projectId =
        input.projectId === undefined
          ? current.projectId
          : await this.resolveProjectId(input.projectId);

      const category =
        input.categoryAccountId && input.categoryAccountId !== current.categoryAccountId
          ? await this.resolveCategory(input.categoryAccountId)
          : {
              id: current.categoryAccount.id,
              code: current.categoryAccount.code,
              name: current.categoryAccount.name,
              type: current.categoryAccount.type,
              active: true,
            };
      const date = input.date ? toDate(input.date, 'date') : current.date;
      const amount =
        input.amount !== undefined ? new Prisma.Decimal(input.amount) : current.amount;
      const memo = input.memo !== undefined ? input.memo.trim() || null : current.memo;
      const receiptNote =
        input.receiptNote !== undefined
          ? input.receiptNote.trim() || null
          : current.receiptNote;

      const financialChanged =
        category.id !== current.categoryAccountId ||
        date.getTime() !== current.date.getTime() ||
        !amount.equals(current.amount);

      let version = current.version;
      if (financialChanged) {
        const latest = await tx.journalEntry.findFirst({
          where: {
            organizationId,
            sourceType: JournalSourceType.EXPENSE,
            sourceId: { startsWith: current.id },
          },
          orderBy: [{ createdAt: 'desc' }, { reference: 'desc' }],
        });
        if (!latest) {
          throw new ConflictException('Expense posting not found; cannot correct it');
        }
        await reverseEntry(tx, organizationId, latest.id, {
          date: isoDate(current.date),
          memo: `Correction of ${current.number}`,
        });
        version = current.version + 1;
      }

      const updated = await tx.expense.update({
        where: { id: current.id },
        data: {
          vendorId,
          projectId,
          categoryAccountId: category.id,
          date,
          amount,
          memo,
          receiptNote,
          version,
        },
        include: EXPENSE_INCLUDE,
      });

      if (financialChanged) {
        const cash = await this.resolveCash();
        await this.post(
          tx,
          organizationId,
          updated,
          vendorId ? { id: vendorId, name: vendorName ?? '' } : null,
          category,
          cash.id,
        );
      }
      return { updated, financialChanged };
    });

    const view = this.toView(outcome.updated);
    await this.audit.record('expense.update', 'Expense', id, {
      number: view.number,
      date: view.date,
      amount: view.amount,
      vendor: view.vendor?.name ?? null,
      projectId: view.projectId,
      category: `${view.categoryAccount.code} ${view.categoryAccount.name}`,
      corrected: outcome.financialChanged,
    });
    return view;
  }

  private async post(
    tx: Prisma.TransactionClient,
    organizationId: string,
    expense: Expense,
    vendor: Pick<Vendor, 'name'> | { id: string; name: string } | null,
    category: CategoryAccount,
    cashAccountId: string,
  ): Promise<void> {
    await this.ledger.postWithin(tx, organizationId, {
      date: isoDate(expense.date),
      memo: `Expense ${expense.number}${vendor ? ` — ${vendor.name}` : ''}`,
      sourceType: JournalSourceType.EXPENSE,
      sourceId:
        expense.version === 1 ? expense.id : `${expense.id}:v${expense.version}`,
      lines: [
        {
          accountId: category.id,
          debit: expense.amount,
          description: `${category.code} ${category.name}`,
        },
        {
          accountId: cashAccountId,
          credit: expense.amount,
          description: `Paid for ${expense.number}`,
        },
      ],
    });
  }

  private async findRow(id: string): Promise<ExpenseRow> {
    const row = await this.scoped.findById<ExpenseRow>('expense', id, {
      include: EXPENSE_INCLUDE,
    });
    if (!row) {
      throw new NotFoundException('Expense not found');
    }
    return row;
  }

  private async resolveProjectId(input: string | undefined): Promise<string | null> {
    if (!input) return null;
    const project = await this.scoped.findById<{ id: string; active: boolean }>('project', input, {
      select: { id: true, active: true },
    });
    if (!project) {
      throw new BadRequestException('Project must belong to this organization');
    }
    return project.id;
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

  private async resolveCategory(accountId: string): Promise<CategoryAccount> {
    const account = await this.scoped.findById<CategoryAccount>('account', accountId, {
      select: { id: true, code: true, name: true, type: true, active: true },
    });
    if (!account) {
      throw new BadRequestException('Category must belong to this organization');
    }
    if (account.type !== 'EXPENSE') {
      throw new BadRequestException('Expense category must be an expense account');
    }
    if (!account.active) {
      throw new BadRequestException('Expense category cannot be inactive');
    }
    return account;
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

  private async nextNumber(
    tx: Prisma.TransactionClient,
    organizationId: string,
  ): Promise<string> {
    const rows = await tx.expense.findMany({
      where: { organizationId, number: { startsWith: 'EXP-' } },
      orderBy: { number: 'desc' },
      take: 1,
      select: { number: true },
    });
    const last = Number.parseInt(rows[0]?.number.slice('EXP-'.length) ?? '0', 10);
    const next = Number.isFinite(last) ? last + 1 : 1;
    return `EXP-${String(next).padStart(4, '0')}`;
  }

  private toView(row: ExpenseRow): ExpenseView {
    return {
      id: row.id,
      number: row.number,
      date: isoDate(row.date),
      vendorId: row.vendorId,
      vendor: row.vendor,
      projectId: row.projectId,
      project: row.project,
      categoryAccountId: row.categoryAccountId,
      categoryAccount: row.categoryAccount,
      amount: toNumber(row.amount),
      memo: row.memo,
      receiptNote: row.receiptNote,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
