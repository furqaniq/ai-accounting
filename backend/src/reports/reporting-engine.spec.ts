import { AccountType, Prisma } from '@prisma/client';
import {
  CashFlowEntry,
  ReportAccountBalances,
  ReportAccountInfo,
  ReportingEngine,
} from './reporting-engine';

function d(value: number | string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function account(
  id: string,
  code: string,
  name: string,
  type: AccountType,
  debit: number | string,
  credit: number | string,
  subtype: string | null = null,
): ReportAccountBalances {
  return { id, code, name, type, subtype, debit: d(debit), credit: d(credit) };
}

function info(
  id: string,
  code: string,
  name: string,
  type: AccountType,
  subtype: string | null = null,
): ReportAccountInfo {
  return { id, code, name, type, subtype };
}

const engine = new ReportingEngine();

describe('ReportingEngine', () => {
  describe('profit and loss', () => {
    it('groups income and expenses and computes net income in native directions', () => {
      const report = engine.profitAndLoss({ from: '2026-01-01', to: '2026-12-31' }, [
        account('a-4000', '4000', 'Sales income', 'INCOME', 0, 1200),
        account('a-6100', '6100', 'Utilities expense', 'EXPENSE', 475, 0),
        account('a-6200', '6200', 'Supplies expense', 'EXPENSE', 600, 0),
        account('a-1000', '1000', 'Cash', 'ASSET', 5000, 0),
      ]);

      expect(report.from).toBe('2026-01-01');
      expect(report.to).toBe('2026-12-31');
      expect(report.groups.map((group) => group.key)).toEqual(['income', 'expense']);
      expect(report.totalIncome).toBe(1200);
      expect(report.totalExpenses).toBe(1075);
      expect(report.netIncome).toBe(125);
      expect(report.groups[1].accounts.map((row) => row.code)).toEqual(['6100', '6200']);
    });

    it('returns zero totals for an empty period', () => {
      const report = engine.profitAndLoss({ from: '2026-11-01', to: '2026-11-30' }, [
        account('a-4000', '4000', 'Sales income', 'INCOME', 0, 0),
        account('a-6100', '6100', 'Utilities expense', 'EXPENSE', 0, 0),
      ]);

      expect(report.totalIncome).toBe(0);
      expect(report.totalExpenses).toBe(0);
      expect(report.netIncome).toBe(0);
      expect(report.groups.every((group) => group.accounts.length === 0)).toBe(true);
    });

    it('does not leak prior-period activity into the requested range', () => {
      const report = engine.profitAndLoss({ from: '2026-10-01', to: '2026-10-31' }, [
        account('a-4000', '4000', 'Sales income', 'INCOME', 0, 300),
        account('a-6100', '6100', 'Utilities expense', 'EXPENSE', 600, 0),
      ]);

      expect(report.totalIncome).toBe(300);
      expect(report.totalExpenses).toBe(600);
      expect(report.netIncome).toBe(-300);
    });
  });

  describe('balance sheet', () => {
    it('includes unclosed current earnings in equity so assets balance', () => {
      const report = engine.balanceSheet('2026-12-31', [
        account('a-1000', '1000', 'Cash', 'ASSET', 5000, 0, 'Current asset'),
        account('a-1100', '1100', 'Accounts receivable', 'ASSET', 1274.25, 0, 'Accounts receivable'),
        account('a-1300', '1300', 'Purchase tax receivable', 'ASSET', 49.5, 0, 'Current asset'),
        account('a-2000', '2000', 'Accounts payable', 'LIABILITY', 0, 1124.5, 'Accounts payable'),
        account('a-2100', '2100', 'Sales tax payable', 'LIABILITY', 0, 74.25, 'Current liability'),
        account('a-3000', '3000', 'Owner equity', 'EQUITY', 0, 5000, 'Equity'),
        account('a-4000', '4000', 'Sales income', 'INCOME', 0, 1200),
        account('a-6100', '6100', 'Utilities expense', 'EXPENSE', 475, 0),
        account('a-6200', '6200', 'Supplies expense', 'EXPENSE', 600, 0),
      ]);

      expect(report.totalAssets).toBe(6323.75);
      expect(report.totalLiabilities).toBe(1198.75);
      expect(report.currentEarnings).toBe(125);
      expect(report.totalEquity).toBe(5125);
      expect(report.totalLiabilitiesAndEquity).toBe(6323.75);
      expect(report.balanced).toBe(true);
      expect(
        report.groups[2].accounts.find((row) => row.name === 'Current earnings'),
      ).toMatchObject({ accountId: null, amount: 125, synthetic: true });
    });

    it('does not double count earnings that have already been closed to retained earnings', () => {
      const report = engine.balanceSheet('2026-12-31', [
        account('a-1000', '1000', 'Cash', 'ASSET', 5000, 0),
        account('a-3100', '3100', 'Retained earnings', 'EQUITY', 0, 5000, 'Equity'),
        account('a-4000', '4000', 'Sales income', 'INCOME', 0, 0),
        account('a-6100', '6100', 'Utilities expense', 'EXPENSE', 0, 0),
      ]);

      expect(report.currentEarnings).toBe(0);
      expect(report.totalEquity).toBe(5000);
      expect(report.balanced).toBe(true);
    });
  });

  describe('trial balance', () => {
    it('places each net account balance in the debit or credit column and proves equality', () => {
      const report = engine.trialBalance('2026-12-31', [
        account('a-1000', '1000', 'Cash', 'ASSET', 5000, 0),
        account('a-1100', '1100', 'Accounts receivable', 'ASSET', 1274.25, 0),
        account('a-1300', '1300', 'Purchase tax receivable', 'ASSET', 49.5, 0),
        account('a-2000', '2000', 'Accounts payable', 'LIABILITY', 0, 1124.5),
        account('a-2100', '2100', 'Sales tax payable', 'LIABILITY', 0, 74.25),
        account('a-3000', '3000', 'Owner equity', 'EQUITY', 0, 5000),
        account('a-4000', '4000', 'Sales income', 'INCOME', 0, 1200),
        account('a-6100', '6100', 'Utilities expense', 'EXPENSE', 475, 0),
        account('a-6200', '6200', 'Supplies expense', 'EXPENSE', 600, 0),
      ]);

      expect(report.totalDebit).toBe(7398.75);
      expect(report.totalCredit).toBe(7398.75);
      expect(report.debitsEqualCredits).toBe(true);
      expect(report.rows.map((row) => row.code)).toEqual([
        '1000',
        '1100',
        '1300',
        '2000',
        '2100',
        '3000',
        '4000',
        '6100',
        '6200',
      ]);
      expect(report.rows.find((row) => row.code === '2100')).toMatchObject({
        debit: 0,
        credit: 74.25,
      });
    });

    it('omits zero-balance accounts', () => {
      const report = engine.trialBalance('2026-01-01', [
        account('a-1000', '1000', 'Cash', 'ASSET', 0, 0),
      ]);

      expect(report.rows).toHaveLength(0);
      expect(report.debitsEqualCredits).toBe(true);
    });
  });

  describe('cash flow', () => {
    const cash: ReportAccountInfo[] = [info('a-1000', '1000', 'Cash', 'ASSET', 'Current asset')];

    function entry(
      id: string,
      date: string,
      lines: Array<{
        account: ReportAccountInfo;
        debit?: number;
        credit?: number;
      }>,
    ): CashFlowEntry {
      return {
        id,
        date,
        lines: lines.map((line) => ({
          accountId: line.account.id,
          debit: d(line.debit ?? 0),
          credit: d(line.credit ?? 0),
          account: line.account,
        })),
      };
    }

    it('explains movements by counterpart account and reconciles beginning to ending cash', () => {
      const report = engine.cashFlow({
        from: '2026-01-01',
        to: '2026-12-31',
        cashAccounts: cash,
        beginningCash: d(0),
        endingCash: d(5000),
        entries: [
          entry('e1', '2026-01-02', [
            { account: info('a-1000', '1000', 'Cash', 'ASSET', 'Current asset'), debit: 5000 },
            { account: info('a-3000', '3000', 'Owner equity', 'EQUITY', 'Equity'), credit: 5000 },
          ]),
        ],
      });

      expect(report.beginningCash).toBe(0);
      expect(report.netChange).toBe(5000);
      expect(report.endingCash).toBe(5000);
      expect(report.reconciled).toBe(true);
      expect(report.groups.find((group) => group.key === 'financing')?.lines).toEqual([
        { accountId: 'a-3000', code: '3000', name: 'Owner equity', amount: 5000 },
      ]);
      expect(report.groups.find((group) => group.key === 'operating')?.total).toBe(0);
    });

    it('classifies working capital as operating, fixed assets as investing, and debt as financing', () => {
      const report = engine.cashFlow({
        from: '2026-02-01',
        to: '2026-12-31',
        cashAccounts: cash,
        beginningCash: d(5000),
        endingCash: d(5300),
        entries: [
          entry('e1', '2026-03-01', [
            { account: info('a-1100', '1100', 'Accounts receivable', 'ASSET', 'Accounts receivable'), credit: 700 },
            { account: info('a-1000', '1000', 'Cash', 'ASSET', 'Current asset'), debit: 700 },
          ]),
          entry('e2', '2026-04-01', [
            { account: info('a-1500', '1500', 'Equipment', 'ASSET', 'Fixed asset'), debit: 1000 },
            { account: info('a-1000', '1000', 'Cash', 'ASSET', 'Current asset'), credit: 1000 },
          ]),
          entry('e3', '2026-05-01', [
            { account: info('a-1000', '1000', 'Cash', 'ASSET', 'Current asset'), debit: 600 },
            { account: info('a-2500', '2500', 'Long-term debt', 'LIABILITY', 'Long-term liability'), credit: 600 },
          ]),
        ],
      });

      expect(report.groups.find((group) => group.key === 'operating')?.total).toBe(700);
      expect(report.groups.find((group) => group.key === 'investing')?.total).toBe(-1000);
      expect(report.groups.find((group) => group.key === 'financing')?.total).toBe(600);
      expect(report.netChange).toBe(300);
      expect(report.reconciled).toBe(true);
    });

    it('excludes pure cash transfers and non-cash entries, and handles a prior-period opening', () => {
      const report = engine.cashFlow({
        from: '2026-02-01',
        to: '2026-12-31',
        cashAccounts: [
          info('a-1000', '1000', 'Cash', 'ASSET', 'Current asset'),
          info('a-1010', '1010', 'Savings', 'ASSET', 'Current asset'),
        ],
        beginningCash: d(5000),
        endingCash: d(5000),
        entries: [
          entry('transfer', '2026-03-01', [
            { account: info('a-1000', '1000', 'Cash', 'ASSET', 'Current asset'), credit: 500 },
            { account: info('a-1010', '1010', 'Savings', 'ASSET', 'Current asset'), debit: 500 },
          ]),
          entry('invoice', '2026-03-02', [
            { account: info('a-1100', '1100', 'Accounts receivable', 'ASSET', 'Accounts receivable'), debit: 300 },
            { account: info('a-4000', '4000', 'Sales income', 'INCOME', 'Income'), credit: 300 },
          ]),
        ],
      });

      expect(report.netChange).toBe(0);
      expect(report.groups.every((group) => group.lines.length === 0)).toBe(true);
      expect(report.reconciled).toBe(true);
    });
  });
});
