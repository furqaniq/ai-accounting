import { Injectable, NotFoundException } from '@nestjs/common';
import { Account, JournalSourceType, Prisma } from '@prisma/client';
import { AuditService } from '../tenant/audit.service';
import { ScopedDataAccess } from '../tenant/scoped-data-access.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import {
  CreateJournalEntryDto,
  ListJournalEntriesDto,
  RegisterQueryDto,
  ReverseJournalEntryDto,
} from './ledger.dto';
import {
  JournalEntryView,
  LedgerEngine,
  nativeBalance,
  toDate,
  toEntryView,
  toNumber,
} from './ledger-engine';

type EntryRow = Prisma.JournalEntryGetPayload<{
  include: {
    lines: { include: { account: { select: { id: true; code: true; name: true; type: true } } } };
    reversedBy: { select: { id: true; reference: true } };
    reversalOf: { select: { id: true; reference: true } };
  };
}>;

type LineRow = Prisma.JournalLineGetPayload<{
  include: {
    entry: {
      select: {
        id: true;
        reference: true;
        date: true;
        memo: true;
        sourceType: true;
        sourceId: true;
        reversalOfId: true;
      };
    };
  };
}>;

const ENTRY_INCLUDE = {
  lines: { include: { account: { select: { id: true, code: true, name: true, type: true } } } },
  reversedBy: { select: { id: true, reference: true } },
  reversalOf: { select: { id: true, reference: true } },
} as const;

export interface RegisterLineView {
  id: string;
  entryId: string;
  reference: string;
  date: string;
  memo: string | null;
  description: string | null;
  sourceType: JournalSourceType;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface RegisterView {
  account: { id: string; code: string; name: string; type: string };
  from: string | null;
  to: string | null;
  openingBalance: number;
  closingBalance: number;
  totalDebit: number;
  totalCredit: number;
  lines: RegisterLineView[];
}

@Injectable()
export class LedgerService {
  constructor(
    private readonly scoped: ScopedDataAccess,
    private readonly tenant: TenantContextService,
    private readonly engine: LedgerEngine,
    private readonly audit: AuditService,
  ) {}

  async list(filters: ListJournalEntriesDto): Promise<JournalEntryView[]> {
    const where: Record<string, unknown> = {};
    const date: Record<string, Date> = {};
    if (filters.from) date.gte = toDate(filters.from, 'from');
    if (filters.to) date.lte = toDate(filters.to, 'to');
    if (Object.keys(date).length > 0) where.date = date;
    if (filters.accountId) where.lines = { some: { accountId: filters.accountId } };

    const entries = await this.scoped.findMany<EntryRow>('journalEntry', {
      where,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: filters.limit ?? 100,
      include: ENTRY_INCLUDE,
    });
    return entries.map(toEntryView);
  }

  async find(id: string): Promise<JournalEntryView> {
    const entry = await this.scoped.findById<EntryRow>('journalEntry', id, {
      include: ENTRY_INCLUDE,
    });
    if (!entry) {
      throw new NotFoundException('Journal entry not found');
    }
    return toEntryView(entry);
  }

  async post(input: CreateJournalEntryDto): Promise<JournalEntryView> {
    const { organizationId } = await this.tenant.get();
    const entry = await this.engine.post(organizationId, input);
    await this.audit.record('ledger.entry.post', 'JournalEntry', entry.id, {
      reference: entry.reference,
      date: entry.date,
      memo: entry.memo,
      amount: entry.lines.reduce((total, line) => total + line.debit, 0),
      lines: entry.lines.map((line) => ({
        accountId: line.accountId,
        account: `${line.account.code} ${line.account.name}`,
        debit: line.debit,
        credit: line.credit,
      })),
    });
    return entry;
  }

  async reverse(id: string, input: ReverseJournalEntryDto): Promise<JournalEntryView> {
    const { organizationId } = await this.tenant.get();
    const original = await this.find(id);
    const reversal = await this.engine.reverse(organizationId, id, input);
    await this.audit.record('ledger.entry.reverse', 'JournalEntry', reversal.id, {
      entryId: original.id,
      reference: original.reference,
      reversalReference: reversal.reference,
      memo: reversal.memo,
    });
    return reversal;
  }

  async register(query: RegisterQueryDto): Promise<RegisterView> {
    const account = await this.scoped.findById<Account>('account', query.accountId);
    if (!account) {
      throw new NotFoundException('Account not found');
    }

    const from = query.from ? toDate(query.from, 'from') : null;
    const to = query.to ? toDate(query.to, 'to') : null;
    const entryDate: Record<string, Date> = {};
    if (to) entryDate.lte = to;

    const lines = await this.scoped.findMany<LineRow>('journalLine', {
      where: {
        accountId: account.id,
        ...(Object.keys(entryDate).length > 0 ? { entry: { date: entryDate } } : {}),
      },
      orderBy: [{ entry: { date: 'asc' } }, { createdAt: 'asc' }],
      include: {
        entry: {
          select: {
            id: true,
            reference: true,
            date: true,
            memo: true,
            sourceType: true,
            sourceId: true,
            reversalOfId: true,
          },
        },
      },
    });

    let opening = new Prisma.Decimal(0);
    let running = new Prisma.Decimal(0);
    let totalDebit = new Prisma.Decimal(0);
    let totalCredit = new Prisma.Decimal(0);
    const window: RegisterLineView[] = [];

    for (const line of lines) {
      const delta = nativeBalance(account.type, line.debit, line.credit);
      running = running.plus(delta);
      if (from && line.entry.date < from) {
        opening = opening.plus(delta);
        continue;
      }
      totalDebit = totalDebit.plus(line.debit);
      totalCredit = totalCredit.plus(line.credit);
      window.push({
        id: line.id,
        entryId: line.entry.id,
        reference: line.entry.reference,
        date: line.entry.date.toISOString().slice(0, 10),
        memo: line.entry.memo,
        description: line.description,
        sourceType: line.entry.sourceType,
        debit: toNumber(line.debit),
        credit: toNumber(line.credit),
        runningBalance: toNumber(running),
      });
    }

    const openingBalance = from ? opening : new Prisma.Decimal(0);
    const closing = running;

    return {
      account: { id: account.id, code: account.code, name: account.name, type: account.type },
      from: from ? from.toISOString().slice(0, 10) : null,
      to: to ? to.toISOString().slice(0, 10) : null,
      openingBalance: toNumber(openingBalance),
      closingBalance: toNumber(closing),
      totalDebit: toNumber(totalDebit),
      totalCredit: toNumber(totalCredit),
      lines: window,
    };
  }
}
