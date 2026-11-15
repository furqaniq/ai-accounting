import { Injectable } from '@nestjs/common';
import { AccountType, Prisma } from '@prisma/client';
import { nativeBalance } from '../ledger/ledger-engine';

export interface ReportAccountBalances {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  subtype: string | null;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
}

export interface ReportAccountInfo {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  subtype: string | null;
}

export interface ReportAccountRow {
  accountId: string | null;
  code: string | null;
  name: string;
  amount: number;
  synthetic?: boolean;
}

export interface StatementGroup {
  key: string;
  label: string;
  accounts: ReportAccountRow[];
  total: number;
}

export interface ProfitLossReport {
  report: 'profit-loss';
  from: string;
  to: string;
  groups: StatementGroup[];
  totalIncome: number;
  totalExpenses: number;
  netIncome: number;
}

export interface BalanceSheetReport {
  report: 'balance-sheet';
  asOf: string;
  groups: StatementGroup[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  totalLiabilitiesAndEquity: number;
  currentEarnings: number;
  balanced: boolean;
}

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  debit: number;
  credit: number;
}

export interface TrialBalanceReport {
  report: 'trial-balance';
  asOf: string;
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  debitsEqualCredits: boolean;
}

export type CashFlowClassification = 'operating' | 'investing' | 'financing';

export interface CashFlowEntryLine {
  accountId: string;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  account: ReportAccountInfo;
}

export interface CashFlowEntry {
  id: string;
  date: string;
  lines: CashFlowEntryLine[];
}

export interface CashFlowLine {
  accountId: string;
  code: string;
  name: string;
  amount: number;
}

export interface CashFlowGroup {
  key: CashFlowClassification;
  label: string;
  lines: CashFlowLine[];
  total: number;
}

export interface CashFlowReport {
  report: 'cash-flow';
  from: string;
  to: string;
  cashAccounts: Array<{ id: string; code: string; name: string; type: AccountType }>;
  beginningCash: number;
  netChange: number;
  endingCash: number;
  groups: CashFlowGroup[];
  reconciled: boolean;
}

const CLASSIFICATION_LABELS: Record<CashFlowClassification, string> = {
  operating: 'Operating activities',
  investing: 'Investing activities',
  financing: 'Financing activities',
};

function zero(): Prisma.Decimal {
  return new Prisma.Decimal(0);
}

function money(value: Prisma.Decimal): number {
  const rounded = value.toDecimalPlaces(2);
  return rounded.isZero() ? 0 : Number(rounded.toString());
}

function byCode(left: { code: string | null }, right: { code: string | null }): number {
  const leftCode = left.code ?? '\uffff';
  const rightCode = right.code ?? '\uffff';
  return leftCode.localeCompare(rightCode, 'en', { numeric: true });
}

function sortedGroups(key: string, label: string, rows: ReportAccountRow[]): StatementGroup {
  rows.sort((left, right) => (left.code ?? '').localeCompare(right.code ?? '', 'en', { numeric: true }));
  return {
    key,
    label,
    accounts: rows,
    total: money(
      rows.reduce((sum, row) => sum.plus(new Prisma.Decimal(row.amount)), zero()),
    ),
  };
}

/**
 * Pure statement assembly. Reads only the rows handed in; the service owns
 * tenant-scoped data loading. Sign conventions follow the ledger: assets and
 * expenses are debit-positive, liabilities/equity/income credit-positive.
 */
@Injectable()
export class ReportingEngine {
  profitAndLoss(
    period: { from: string; to: string },
    accounts: ReportAccountBalances[],
  ): ProfitLossReport {
    const income: ReportAccountRow[] = [];
    const expense: ReportAccountRow[] = [];

    for (const account of accounts) {
      if (account.type !== 'INCOME' && account.type !== 'EXPENSE') continue;
      const amount = nativeBalance(account.type, account.debit, account.credit);
      if (amount.isZero()) continue;
      const row: ReportAccountRow = {
        accountId: account.id,
        code: account.code,
        name: account.name,
        amount: money(amount),
      };
      if (account.type === 'INCOME') income.push(row);
      else expense.push(row);
    }

    const incomeGroup = sortedGroups('income', 'Income', income);
    const expenseGroup = sortedGroups('expense', 'Expenses', expense);
    const totalIncome = incomeGroup.total;
    const totalExpenses = expenseGroup.total;

    return {
      report: 'profit-loss',
      from: period.from,
      to: period.to,
      groups: [incomeGroup, expenseGroup],
      totalIncome,
      totalExpenses,
      netIncome: money(
        new Prisma.Decimal(totalIncome).minus(new Prisma.Decimal(totalExpenses)),
      ),
    };
  }

  balanceSheet(
    asOf: string,
    accounts: ReportAccountBalances[],
  ): BalanceSheetReport {
    const assets: ReportAccountRow[] = [];
    const liabilities: ReportAccountRow[] = [];
    const equity: ReportAccountRow[] = [];
    let incomeTotal = zero();
    let expenseTotal = zero();

    for (const account of accounts) {
      const amount = nativeBalance(account.type, account.debit, account.credit);
      if (account.type === 'INCOME') incomeTotal = incomeTotal.plus(amount);
      if (account.type === 'EXPENSE') expenseTotal = expenseTotal.plus(amount);
      if (amount.isZero()) continue;

      const row: ReportAccountRow = {
        accountId: account.id,
        code: account.code,
        name: account.name,
        amount: money(amount),
      };
      if (account.type === 'ASSET') assets.push(row);
      if (account.type === 'LIABILITY') liabilities.push(row);
      if (account.type === 'EQUITY') equity.push(row);
    }

    const currentEarnings = incomeTotal.minus(expenseTotal);
    equity.sort(byCode);
    equity.push({
      accountId: null,
      code: null,
      name: 'Current earnings',
      amount: money(currentEarnings),
      synthetic: true,
    });

    const assetGroup = sortedGroups('assets', 'Assets', assets);
    const liabilityGroup = sortedGroups('liabilities', 'Liabilities', liabilities);
    const equityGroup = sortedGroups('equity', 'Equity', equity);
    const totalLiabilitiesAndEquity = money(
      new Prisma.Decimal(liabilityGroup.total).plus(new Prisma.Decimal(equityGroup.total)),
    );

    return {
      report: 'balance-sheet',
      asOf,
      groups: [assetGroup, liabilityGroup, equityGroup],
      totalAssets: assetGroup.total,
      totalLiabilities: liabilityGroup.total,
      totalEquity: equityGroup.total,
      totalLiabilitiesAndEquity,
      currentEarnings: money(currentEarnings),
      balanced: assetGroup.total === totalLiabilitiesAndEquity,
    };
  }

  trialBalance(asOf: string, accounts: ReportAccountBalances[]): TrialBalanceReport {
    const rows: TrialBalanceRow[] = [];
    let totalDebit = zero();
    let totalCredit = zero();

    for (const account of accounts) {
      const net = account.debit.minus(account.credit);
      if (net.isZero()) continue;
      const debit = net.gt(0) ? net : zero();
      const credit = net.lt(0) ? net.negated() : zero();
      totalDebit = totalDebit.plus(debit);
      totalCredit = totalCredit.plus(credit);
      rows.push({
        accountId: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        debit: money(debit),
        credit: money(credit),
      });
    }

    rows.sort(byCode);
    const debitValue = money(totalDebit);
    const creditValue = money(totalCredit);

    return {
      report: 'trial-balance',
      asOf,
      rows,
      totalDebit: debitValue,
      totalCredit: creditValue,
      debitsEqualCredits: debitValue === creditValue,
    };
  }

  cashFlow(input: {
    from: string;
    to: string;
    cashAccounts: ReportAccountInfo[];
    beginningCash: Prisma.Decimal;
    endingCash: Prisma.Decimal;
    entries: CashFlowEntry[];
  }): CashFlowReport {
    const cashIds = new Set(input.cashAccounts.map((account) => account.id));
    const buckets: Record<CashFlowClassification, Map<string, CashFlowLine>> = {
      operating: new Map(),
      investing: new Map(),
      financing: new Map(),
    };
    let netChange = zero();

    for (const entry of input.entries) {
      const touchesCash = entry.lines.some((line) => cashIds.has(line.accountId));
      if (!touchesCash) continue;

      const counterparties = entry.lines.filter(
        (line) => !cashIds.has(line.accountId) && !line.debit.plus(line.credit).isZero(),
      );
      // A transfer between two cash accounts has no counterpart, so it is not
      // a cash movement at all and must not be restated as income or expense.
      if (counterparties.length === 0) continue;

      for (const line of counterparties) {
        const contribution = line.credit.minus(line.debit);
        if (contribution.isZero()) continue;
        netChange = netChange.plus(contribution);
        const classification = this.classify(line.account.type, line.account.subtype);
        const bucket = buckets[classification];
        const existing = bucket.get(line.account.id);
        if (existing) {
          existing.amount = money(new Prisma.Decimal(existing.amount).plus(contribution));
        } else {
          bucket.set(line.account.id, {
            accountId: line.account.id,
            code: line.account.code,
            name: line.account.name,
            amount: money(contribution),
          });
        }
      }
    }

    const groups: CashFlowGroup[] = (['operating', 'investing', 'financing'] as const).map(
      (key) => {
        const lines = [...buckets[key].values()].filter((line) => line.amount !== 0).sort(byCode);
        return {
          key,
          label: CLASSIFICATION_LABELS[key],
          lines,
          total: money(
            lines.reduce((sum, line) => sum.plus(new Prisma.Decimal(line.amount)), zero()),
          ),
        };
      },
    );

    const net = money(netChange);
    const beginningCash = money(input.beginningCash);
    const endingCash = money(input.endingCash);

    return {
      report: 'cash-flow',
      from: input.from,
      to: input.to,
      cashAccounts: input.cashAccounts.map((account) => ({
        id: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
      })),
      beginningCash,
      netChange: net,
      endingCash,
      groups,
      reconciled: money(new Prisma.Decimal(beginningCash).plus(new Prisma.Decimal(net))) === endingCash,
    };
  }

  private classify(type: AccountType, subtype: string | null): CashFlowClassification {
    const label = (subtype ?? '').toLowerCase();
    if (type === 'INCOME' || type === 'EXPENSE') return 'operating';
    if (type === 'ASSET') {
      return /fixed|long[- ]?term|property|equipment/.test(label) ? 'investing' : 'operating';
    }
    if (type === 'LIABILITY') {
      return /payable|current/.test(label) ? 'operating' : 'financing';
    }
    return 'financing';
  }
}
