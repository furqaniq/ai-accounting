import { Injectable } from '@nestjs/common';
import {
  BankImportFormat,
  BankTransactionMatchState,
  Prisma,
} from '@prisma/client';
import { toDate, toNumber } from '../ledger/ledger-engine';
import { ScopedDataAccess } from '../tenant/scoped-data-access.service';
import { ListBankTransactionsDto } from './bank-transaction.dto';

const TRANSACTION_INCLUDE = {
  bankAccount: { select: { id: true, name: true, type: true } },
  importBatch: {
    select: { id: true, filename: true, format: true, createdAt: true },
  },
  categoryAccount: { select: { id: true, code: true, name: true } },
  categoryRule: { select: { id: true, descriptionContains: true } },
} as const;

type BankTransactionRow = Prisma.BankTransactionGetPayload<{
  include: typeof TRANSACTION_INCLUDE;
}>;

export interface BankTransactionView {
  id: string;
  bankAccountId: string;
  bankAccount: { id: string; name: string; type: string };
  importBatchId: string;
  importBatch: {
    id: string;
    filename: string;
    format: BankImportFormat;
    createdAt: string;
  };
  date: string;
  description: string;
  amount: number;
  externalId: string | null;
  matchState: BankTransactionMatchState;
  categoryAccountId: string | null;
  categoryRuleId: string | null;
  categoryAccount: { id: string; code: string; name: string } | null;
  categoryRule: { id: string; descriptionContains: string } | null;
  createdAt: string;
}

@Injectable()
export class BankTransactionsService {
  constructor(private readonly scoped: ScopedDataAccess) {}

  async list(filters: ListBankTransactionsDto): Promise<BankTransactionView[]> {
    const where: Record<string, unknown> = {};
    if (filters.bankAccountId) where.bankAccountId = filters.bankAccountId;
    if (filters.matchState) where.matchState = filters.matchState;
    const date: Record<string, Date> = {};
    if (filters.from) date.gte = toDate(filters.from, 'from');
    if (filters.to) date.lte = toDate(filters.to, 'to');
    if (Object.keys(date).length > 0) where.date = date;
    if (filters.search?.trim()) {
      where.description = { contains: filters.search.trim(), mode: 'insensitive' };
    }

    const rows = await this.scoped.findMany<BankTransactionRow>('bankTransaction', {
      where,
      include: TRANSACTION_INCLUDE,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    return rows.map((row) => this.toView(row));
  }

  private toView(row: BankTransactionRow): BankTransactionView {
    return {
      id: row.id,
      bankAccountId: row.bankAccountId,
      bankAccount: row.bankAccount,
      importBatchId: row.importBatchId,
      importBatch: {
        ...row.importBatch,
        createdAt: row.importBatch.createdAt.toISOString(),
      },
      date: row.date.toISOString().slice(0, 10),
      description: row.description,
      amount: toNumber(row.amount),
      externalId: row.externalId,
      matchState: row.matchState,
      categoryAccountId: row.categoryAccountId,
      categoryRuleId: row.categoryRuleId,
      categoryAccount: row.categoryAccount,
      categoryRule: row.categoryRule,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
