import { Injectable } from '@nestjs/common';
import { BillStatus, InvoiceStatus, PaymentDirection, Prisma } from '@prisma/client';
import { toNumber } from '../ledger/ledger-engine';
import { ScopedDataAccess } from '../tenant/scoped-data-access.service';

export enum MatchEntityType {
  INVOICE = 'INVOICE',
  BILL = 'BILL',
  PAYMENT = 'PAYMENT',
  EXPENSE = 'EXPENSE',
}

export interface MatchTransaction {
  date: Date;
  description: string;
  amount: number;
}

export interface MatchSuggestion {
  entityType: MatchEntityType;
  entityId: string;
  number: string;
  label: string;
  amount: number;
  date: string;
  score: number;
  rank: number;
  daysFromTransaction: number;
  reasons: string[];
}

interface InvoiceRow {
  id: string;
  number: string;
  dueDate: Date;
  total: Prisma.Decimal;
  amountPaid: Prisma.Decimal;
  notes: string | null;
  customer: { name: string };
}

interface BillRow {
  id: string;
  number: string;
  dueDate: Date;
  total: Prisma.Decimal;
  amountPaid: Prisma.Decimal;
  notes: string | null;
  vendor: { name: string };
}

interface PaymentRow {
  id: string;
  number: string;
  date: Date;
  amount: Prisma.Decimal;
  reference: string | null;
  notes: string | null;
  customer: { name: string };
}

interface ExpenseRow {
  id: string;
  number: string;
  date: Date;
  amount: Prisma.Decimal;
  memo: string | null;
  receiptNote: string | null;
  vendor: { name: string } | null;
  categoryAccount: { code: string; name: string };
}

interface ScoredCandidate {
  entityType: MatchEntityType;
  entityId: string;
  number: string;
  label: string;
  amount: number;
  date: Date;
  description: string;
  score: number;
  daysFromTransaction: number;
  reasons: string[];
  amountDiff: number;
}

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'from',
  'with',
  'payment',
  'invoice',
  'bill',
  'expense',
  'bank',
  'transfer',
  'deposit',
  'withdrawal',
  'online',
  'card',
  'purchase',
  'pymt',
  'inv',
]);

const TYPE_ORDER: Record<MatchEntityType, number> = {
  [MatchEntityType.INVOICE]: 0,
  [MatchEntityType.PAYMENT]: 1,
  [MatchEntityType.BILL]: 2,
  [MatchEntityType.EXPENSE]: 3,
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function words(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

function dayNumber(value: Date): number {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

function calendarDaysApart(left: Date, right: Date): number {
  return Math.abs(dayNumber(left) - dayNumber(right)) / 86_400_000;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

@Injectable()
export class MatchingEngine {
  constructor(private readonly scoped: ScopedDataAccess) {}

  async suggest(transaction: MatchTransaction): Promise<MatchSuggestion[]> {
    if (transaction.amount === 0) return [];
    const candidates =
      transaction.amount > 0
        ? await this.depositCandidates()
        : await this.withdrawalCandidates();

    return candidates
      .map((candidate) => this.score(transaction, candidate))
      .filter((candidate) => candidate.score >= 10)
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        if (left.daysFromTransaction !== right.daysFromTransaction) {
          return left.daysFromTransaction - right.daysFromTransaction;
        }
        if (left.amountDiff !== right.amountDiff) return left.amountDiff - right.amountDiff;
        if (TYPE_ORDER[left.entityType] !== TYPE_ORDER[right.entityType]) {
          return TYPE_ORDER[left.entityType] - TYPE_ORDER[right.entityType];
        }
        if (left.number !== right.number) return left.number.localeCompare(right.number);
        return left.entityId.localeCompare(right.entityId);
      })
      .slice(0, 8)
      .map((candidate, index) => ({
        entityType: candidate.entityType,
        entityId: candidate.entityId,
        number: candidate.number,
        label: candidate.label,
        amount: candidate.amount,
        date: isoDate(candidate.date),
        score: candidate.score,
        rank: index + 1,
        daysFromTransaction: candidate.daysFromTransaction,
        reasons: candidate.reasons,
      }));
  }

  private async depositCandidates(): Promise<ScoredCandidate[]> {
    const invoices = await this.scoped.findMany<InvoiceRow>('invoice', {
      where: { status: { in: [InvoiceStatus.SENT, InvoiceStatus.PARTIAL] } },
      include: { customer: { select: { name: true } } },
      orderBy: { dueDate: 'asc' },
      take: 250,
    });
    const payments = await this.scoped.findMany<PaymentRow>('payment', {
      where: { direction: PaymentDirection.RECEIVED },
      include: { customer: { select: { name: true } } },
      orderBy: { date: 'desc' },
      take: 250,
    });

    return [
      ...invoices.map((invoice) => ({
        entityType: MatchEntityType.INVOICE,
        entityId: invoice.id,
        number: invoice.number,
        label: `${invoice.number} · ${invoice.customer.name}`,
        amount: toNumber(invoice.total) - toNumber(invoice.amountPaid),
        date: invoice.dueDate,
        description: [invoice.number, invoice.customer.name, invoice.notes]
          .filter(Boolean)
          .join(' '),
        amountDiff: 0,
        score: 0,
        daysFromTransaction: 0,
        reasons: [],
      })),
      ...payments.map((payment) => ({
        entityType: MatchEntityType.PAYMENT,
        entityId: payment.id,
        number: payment.number,
        label: `${payment.number} · ${payment.customer.name}`,
        amount: toNumber(payment.amount),
        date: payment.date,
        description: [payment.number, payment.customer.name, payment.reference, payment.notes]
          .filter(Boolean)
          .join(' '),
        amountDiff: 0,
        score: 0,
        daysFromTransaction: 0,
        reasons: [],
      })),
    ].filter((candidate) => candidate.amount > 0);
  }

  private async withdrawalCandidates(): Promise<ScoredCandidate[]> {
    const bills = await this.scoped.findMany<BillRow>('bill', {
      where: { status: { in: [BillStatus.OPEN, BillStatus.PARTIAL] } },
      include: { vendor: { select: { name: true } } },
      orderBy: { dueDate: 'asc' },
      take: 250,
    });
    const expenses = await this.scoped.findMany<ExpenseRow>('expense', {
      include: {
        vendor: { select: { name: true } },
        categoryAccount: { select: { code: true, name: true } },
      },
      orderBy: { date: 'desc' },
      take: 250,
    });

    return [
      ...bills.map((bill) => ({
        entityType: MatchEntityType.BILL,
        entityId: bill.id,
        number: bill.number,
        label: `${bill.number} · ${bill.vendor.name}`,
        amount: toNumber(bill.total) - toNumber(bill.amountPaid),
        date: bill.dueDate,
        description: [bill.number, bill.vendor.name, bill.notes].filter(Boolean).join(' '),
        amountDiff: 0,
        score: 0,
        daysFromTransaction: 0,
        reasons: [],
      })),
      ...expenses.map((expense) => ({
        entityType: MatchEntityType.EXPENSE,
        entityId: expense.id,
        number: expense.number,
        label: `${expense.number} · ${expense.categoryAccount.name}`,
        amount: toNumber(expense.amount),
        date: expense.date,
        description: [
          expense.number,
          expense.memo,
          expense.receiptNote,
          expense.vendor?.name,
          expense.categoryAccount.code,
          expense.categoryAccount.name,
        ]
          .filter(Boolean)
          .join(' '),
        amountDiff: 0,
        score: 0,
        daysFromTransaction: 0,
        reasons: [],
      })),
    ].filter((candidate) => candidate.amount > 0);
  }

  private score(
    transaction: MatchTransaction,
    candidate: ScoredCandidate,
  ): ScoredCandidate {
    const amount = Math.abs(transaction.amount);
    const amountDiff = Math.abs(amount - candidate.amount);
    const days = calendarDaysApart(transaction.date, candidate.date);
    const reasons: string[] = [];
    let score = 0;

    if (amountDiff < 0.005) {
      score += 50;
      reasons.push('Amount matches exactly');
    } else if (amountDiff <= 1) {
      score += 40;
      reasons.push(`Amount is $${amountDiff.toFixed(2)} off`);
    } else if (amountDiff <= Math.max(5, amount * 0.02)) {
      score += 25;
      reasons.push(`Amount is $${amountDiff.toFixed(2)} off`);
    }

    if (days === 0) {
      score += 30;
      reasons.push('Same day');
    } else if (days <= 2) {
      score += 24;
      reasons.push(`${days} day${days === 1 ? '' : 's'} away`);
    } else if (days <= 5) {
      score += 18;
      reasons.push(`${days} days away`);
    } else if (days <= 10) {
      score += 12;
      reasons.push(`${days} days away`);
    } else if (days <= 20) {
      score += 6;
      reasons.push(`${days} days away`);
    } else if (days <= 31) {
      score += 3;
      reasons.push(`${days} days away`);
    }

    const number = normalize(candidate.number);
    const description = normalize(transaction.description);
    const descriptionWords = new Set(words(transaction.description));
    const candidateWords = words(candidate.description);
    const sharedWords = candidateWords.filter((word) => descriptionWords.has(word));
    if (number && description.includes(number)) {
      score += 30;
      reasons.push(`Description mentions ${candidate.number}`);
    } else if (sharedWords.length >= 2) {
      score += 15;
      reasons.push('Description shares party or memo words');
    } else if (sharedWords.length === 1) {
      score += 7;
      reasons.push('Description shares a party or memo word');
    }

    return {
      entityType: candidate.entityType,
      entityId: candidate.entityId,
      number: candidate.number,
      label: candidate.label,
      amount: candidate.amount,
      date: candidate.date,
      description: candidate.description,
      score,
      daysFromTransaction: days,
      reasons,
      amountDiff,
    };
  }
}
