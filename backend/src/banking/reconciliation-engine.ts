export type ReconciliationDirection = 'DEBIT' | 'CREDIT';
export type ReconciliationLifecycle = 'ACTIVE' | 'COMPLETED';

export type ReconciliationGuard =
  | { allowed: true }
  | {
      allowed: false;
      reason: 'NOT_ACTIVE' | 'UNBALANCED' | 'NOT_COMPLETED';
    };

export function canComplete(
  status: ReconciliationLifecycle,
  difference: number,
): ReconciliationGuard {
  if (status !== 'ACTIVE') return { allowed: false, reason: 'NOT_ACTIVE' };
  if (Math.round((difference + Number.EPSILON) * 100) / 100 !== 0) {
    return { allowed: false, reason: 'UNBALANCED' };
  }
  return { allowed: true };
}

export function canUndo(status: ReconciliationLifecycle): ReconciliationGuard {
  if (status !== 'COMPLETED') return { allowed: false, reason: 'NOT_COMPLETED' };
  return { allowed: true };
}

export interface ReconciliationTransactionInput {
  amount: number;
  cleared: boolean;
}

export interface ReconciliationInput {
  statementEndingBalance: number;
  openingBalance: number;
  bookBalance: number;
  direction: ReconciliationDirection;
  transactions: ReconciliationTransactionInput[];
}

export interface ReconciliationSummary {
  statementEndingBalance: number;
  openingBalance: number;
  clearedTotal: number;
  clearedBalance: number;
  bookBalance: number;
  difference: number;
  balanced: boolean;
  clearedCount: number;
  transactionCount: number;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function bookMovement(amount: number, direction: ReconciliationDirection): number {
  return direction === 'CREDIT' ? -amount : amount;
}

export function summarizeReconciliation(input: ReconciliationInput): ReconciliationSummary {
  const cleared = input.transactions.filter((transaction) => transaction.cleared);
  const clearedTotal = roundMoney(
    cleared.reduce(
      (total, transaction) => total + bookMovement(transaction.amount, input.direction),
      0,
    ),
  );
  const clearedBalance = roundMoney(input.openingBalance + clearedTotal);
  const difference = roundMoney(input.statementEndingBalance - clearedBalance);

  return {
    statementEndingBalance: roundMoney(input.statementEndingBalance),
    openingBalance: roundMoney(input.openingBalance),
    clearedTotal,
    clearedBalance,
    bookBalance: roundMoney(input.bookBalance),
    difference,
    balanced: difference === 0,
    clearedCount: cleared.length,
    transactionCount: input.transactions.length,
  };
}
