import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AccountType, JournalSourceType, Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Db = PrismaClient | Prisma.TransactionClient;

export interface JournalLineInput {
  accountId: string;
  debit?: number | string | Prisma.Decimal;
  credit?: number | string | Prisma.Decimal;
  description?: string | null;
}

export interface PostEntryInput {
  date: string;
  memo?: string;
  sourceType?: JournalSourceType;
  sourceId?: string;
  reversalOfId?: string;
  lines: JournalLineInput[];
}

export interface ReverseEntryInput {
  date?: string;
  memo?: string;
}

export interface JournalLineView {
  id: string;
  accountId: string;
  account: { id: string; code: string; name: string; type: AccountType };
  description: string | null;
  debit: number;
  credit: number;
}

export interface JournalEntryView {
  id: string;
  reference: string;
  date: string;
  memo: string | null;
  sourceType: JournalSourceType;
  sourceId: string | null;
  reversalOfId: string | null;
  reversalOfReference: string | null;
  reversedById: string | null;
  reversedByReference: string | null;
  createdAt: string;
  lines: JournalLineView[];
}

export interface AccountBalance {
  accountId: string;
  debit: number;
  credit: number;
  balance: number;
  asOf: string | null;
}

interface ValidatedLine {
  accountId: string;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  description: string | null;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const NORMAL_DEBIT_TYPES: AccountType[] = ['ASSET', 'EXPENSE'];

export function toDate(value: string, field = 'date'): Date {
  if (!DATE_PATTERN.test(value)) {
    throw new BadRequestException(`${field} must be a calendar date (YYYY-MM-DD)`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`${field} is not a valid calendar date`);
  }
  return parsed;
}

function amount(value: number | string | Prisma.Decimal | undefined, field: string): Prisma.Decimal {
  if (value === undefined || value === null || value === '') return new Prisma.Decimal(0);
  let parsed: Prisma.Decimal;
  try {
    parsed = new Prisma.Decimal(value);
  } catch {
    throw new BadRequestException(`${field} must be a valid amount`);
  }
  if (parsed.isNegative()) {
    throw new BadRequestException(`${field} cannot be negative; use the other column`);
  }
  if (!parsed.equals(parsed.toDecimalPlaces(2))) {
    throw new BadRequestException(`${field} can have at most two decimal places`);
  }
  return parsed;
}

function normalDirection(type: AccountType): 'debit' | 'credit' {
  return NORMAL_DEBIT_TYPES.includes(type) ? 'debit' : 'credit';
}

/** Account balance in the account's normal direction (assets/expenses debit-positive). */
export function nativeBalance(type: AccountType, debit: Prisma.Decimal, credit: Prisma.Decimal): Prisma.Decimal {
  return normalDirection(type) === 'debit' ? debit.minus(credit) : credit.minus(debit);
}

export function toNumber(value: Prisma.Decimal | number | string): number {
  return Number(value.toString());
}

export function toEntryView(entry: {
  id: string;
  reference: string;
  date: Date;
  memo: string | null;
  sourceType: JournalSourceType;
  sourceId: string | null;
  reversalOfId: string | null;
  reversalOf?: { id: string; reference: string } | null;
  reversedBy?: { id: string; reference: string } | null;
  createdAt: Date;
  lines: Array<{
    id: string;
    accountId: string;
    description: string | null;
    debit: Prisma.Decimal;
    credit: Prisma.Decimal;
    account: { id: string; code: string; name: string; type: AccountType };
  }>;
}): JournalEntryView {
  return {
    id: entry.id,
    reference: entry.reference,
    date: entry.date.toISOString().slice(0, 10),
    memo: entry.memo,
    sourceType: entry.sourceType,
    sourceId: entry.sourceId,
    reversalOfId: entry.reversalOfId,
    reversalOfReference: entry.reversalOf?.reference ?? null,
    reversedById: entry.reversedBy?.id ?? null,
    reversedByReference: entry.reversedBy?.reference ?? null,
    createdAt: entry.createdAt.toISOString(),
    lines: entry.lines.map((line) => ({
      id: line.id,
      accountId: line.accountId,
      account: line.account,
      description: line.description,
      debit: toNumber(line.debit),
      credit: toNumber(line.credit),
    })),
  };
}

async function validateLines(
  db: Db,
  organizationId: string,
  input: JournalLineInput[],
): Promise<ValidatedLine[]> {
  if (!Array.isArray(input) || input.length < 2) {
    throw new BadRequestException('A journal entry needs at least two lines');
  }

  const lines = input.map((line, index) => {
    if (!line?.accountId) {
      throw new BadRequestException(`Line ${index + 1} needs an account`);
    }
    const debit = amount(line.debit, `Line ${index + 1} debit`);
    const credit = amount(line.credit, `Line ${index + 1} credit`);
    const debitPositive = debit.gt(0);
    const creditPositive = credit.gt(0);
    if (debitPositive === creditPositive) {
      throw new BadRequestException(
        `Line ${index + 1} must have either a debit or a credit amount, but not both`,
      );
    }
    return {
      accountId: line.accountId,
      debit,
      credit,
      description: line.description?.trim() ? line.description.trim() : null,
    } satisfies ValidatedLine;
  });

  const totals = lines.reduce(
    (sum, line) => ({ debit: sum.debit.plus(line.debit), credit: sum.credit.plus(line.credit) }),
    { debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(0) },
  );
  if (!totals.debit.equals(totals.credit)) {
    throw new BadRequestException(
      `Journal entry must balance: debits ${totals.debit.toFixed(2)} vs credits ${totals.credit.toFixed(2)}`,
    );
  }
  if (!totals.debit.gt(0)) {
    throw new BadRequestException('Journal entry must move a non-zero amount');
  }

  const accountIds = [...new Set(lines.map((line) => line.accountId))];
  const accounts = await db.account.findMany({
    where: { organizationId, id: { in: accountIds } },
    select: { id: true, active: true },
  });
  const known = new Map(accounts.map((account) => [account.id, account]));
  for (const line of lines) {
    const account = known.get(line.accountId);
    if (!account) {
      throw new BadRequestException('Every line must reference an account in this organization');
    }
    if (!account.active) {
      throw new BadRequestException('New entries cannot post to a deactivated account');
    }
  }
  return lines;
}

async function nextReference(db: Db, organizationId: string): Promise<string> {
  const rows = await db.journalEntry.findMany({
    where: { organizationId, reference: { startsWith: 'JE-' } },
    orderBy: { reference: 'desc' },
    take: 1,
    select: { reference: true },
  });
  const last = Number.parseInt(rows[0]?.reference.slice('JE-'.length) ?? '0', 10);
  const next = Number.isFinite(last) ? last + 1 : 1;
  return `JE-${String(next).padStart(4, '0')}`;
}

/** The one write path for journal tables. All feature modules post through here. */
export async function postEntry(
  db: Db,
  organizationId: string,
  input: PostEntryInput,
): Promise<JournalEntryView> {
  const date = toDate(input.date);
  const lines = await validateLines(db, organizationId, input.lines);

  try {
    const entry = await db.journalEntry.create({
      data: {
        organizationId,
        reference: await nextReference(db, organizationId),
        date,
        memo: input.memo?.trim() || null,
        sourceType: input.sourceType ?? JournalSourceType.MANUAL,
        sourceId: input.sourceId ?? null,
        reversalOfId: input.reversalOfId ?? null,
        lines: {
          create: lines.map((line) => ({
            organizationId,
            accountId: line.accountId,
            description: line.description,
            debit: line.debit,
            credit: line.credit,
          })),
        },
      },
      include: {
        lines: { include: { account: { select: { id: true, code: true, name: true, type: true } } } },
        reversedBy: { select: { id: true, reference: true } },
        reversalOf: { select: { id: true, reference: true } },
      },
    });
    return toEntryView(entry);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException('The ledger is busy; try posting again');
    }
    throw error;
  }
}

export async function reverseEntry(
  db: Db,
  organizationId: string,
  entryId: string,
  input: ReverseEntryInput = {},
): Promise<JournalEntryView> {
  const original = await db.journalEntry.findFirst({
    where: { id: entryId, organizationId },
    include: { lines: true, reversedBy: { select: { id: true } } },
  });
  if (!original) {
    throw new NotFoundException('Journal entry not found');
  }
  if (original.sourceType === JournalSourceType.REVERSAL) {
    throw new BadRequestException('Reversal entries cannot themselves be reversed');
  }
  if (original.reversedBy) {
    throw new ConflictException('That entry has already been reversed');
  }

  const date = input.date ? toDate(input.date) : new Date();
  const lines = original.lines.map((line) => ({
    accountId: line.accountId,
    debit: line.credit,
    credit: line.debit,
    description: line.description,
  }));

  const memo = input.memo?.trim() || `Reversal of ${original.reference}`;
  return postEntry(db, organizationId, {
    date: date.toISOString().slice(0, 10),
    memo,
    sourceType: JournalSourceType.REVERSAL,
    sourceId: original.id,
    reversalOfId: original.id,
    lines,
  });
}

export async function accountBalance(
  db: Db,
  organizationId: string,
  accountId: string,
  options: { asOf?: string } = {},
): Promise<AccountBalance> {
  const account = await db.account.findFirst({
    where: { id: accountId, organizationId },
    select: { id: true, type: true },
  });
  if (!account) {
    throw new NotFoundException('Account not found');
  }
  const asOf = options.asOf ? toDate(options.asOf, 'asOf') : null;
  const totals = await db.journalLine.aggregate({
    where: {
      organizationId,
      accountId,
      entry: asOf ? { date: { lte: asOf } } : undefined,
    },
    _sum: { debit: true, credit: true },
  });
  const debit = totals._sum.debit ?? new Prisma.Decimal(0);
  const credit = totals._sum.credit ?? new Prisma.Decimal(0);
  return {
    accountId,
    debit: toNumber(debit),
    credit: toNumber(credit),
    balance: toNumber(nativeBalance(account.type, debit, credit)),
    asOf: asOf ? asOf.toISOString().slice(0, 10) : null,
  };
}

@Injectable()
export class LedgerEngine {
  constructor(private readonly prisma: PrismaService) {}

  post(organizationId: string, input: PostEntryInput): Promise<JournalEntryView> {
    return this.prisma.$transaction((tx) => this.postWithin(tx, organizationId, input));
  }

  postWithin(
    db: Prisma.TransactionClient,
    organizationId: string,
    input: PostEntryInput,
  ): Promise<JournalEntryView> {
    return postEntry(db, organizationId, input);
  }

  reverse(
    organizationId: string,
    entryId: string,
    input: ReverseEntryInput = {},
  ): Promise<JournalEntryView> {
    return this.prisma.$transaction((tx) => reverseEntry(tx, organizationId, entryId, input));
  }

  balance(
    organizationId: string,
    accountId: string,
    options: { asOf?: string } = {},
  ): Promise<AccountBalance> {
    return accountBalance(this.prisma, organizationId, accountId, options);
  }
}
