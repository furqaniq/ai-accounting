import { summarizeReconciliation } from './reconciliation-engine';

describe('summarizeReconciliation', () => {
  it('starts from the opening balance when nothing is cleared', () => {
    const summary = summarizeReconciliation({
      statementEndingBalance: 42180.22,
      openingBalance: 40920.22,
      bookBalance: 42180.22,
      direction: 'DEBIT',
      transactions: [
        { amount: 1000, cleared: false },
        { amount: -18, cleared: false },
      ],
    });

    expect(summary).toMatchObject({
      clearedTotal: 0,
      clearedBalance: 40920.22,
      bookBalance: 42180.22,
      difference: 1260,
      balanced: false,
      clearedCount: 0,
      transactionCount: 2,
    });
  });

  it('sums cleared deposits and withdrawals in book direction', () => {
    const summary = summarizeReconciliation({
      statementEndingBalance: 42180.22,
      openingBalance: 40920.22,
      bookBalance: 42180.22,
      direction: 'DEBIT',
      transactions: [
        { amount: 1000, cleared: true },
        { amount: 160, cleared: true },
        { amount: 100, cleared: true },
        { amount: -64.2, cleared: true },
        { amount: -18, cleared: true },
        { amount: 1000, cleared: false },
      ],
    });

    expect(summary).toMatchObject({
      clearedTotal: 1177.8,
      clearedBalance: 42098.02,
      difference: 82.2,
      balanced: false,
      clearedCount: 5,
      transactionCount: 6,
    });
  });

  it('recalculates when a cleared transaction is unmarked', () => {
    const cleared = summarizeReconciliation({
      statementEndingBalance: 42180.22,
      openingBalance: 40920.22,
      bookBalance: 42180.22,
      direction: 'DEBIT',
      transactions: [
        { amount: 1000, cleared: true },
        { amount: 160, cleared: true },
        { amount: 100, cleared: true },
      ],
    });
    const unmarked = summarizeReconciliation({
      statementEndingBalance: 42180.22,
      openingBalance: 40920.22,
      bookBalance: 42180.22,
      direction: 'DEBIT',
      transactions: [
        { amount: 1000, cleared: true },
        { amount: 160, cleared: false },
        { amount: 100, cleared: true },
      ],
    });

    expect(cleared).toMatchObject({ difference: 0, balanced: true, clearedCount: 3 });
    expect(unmarked).toMatchObject({
      clearedTotal: 1100,
      clearedBalance: 42020.22,
      difference: 160,
      balanced: false,
      clearedCount: 2,
    });
  });

  it('treats credit-card activity as a reduction of the liability', () => {
    const summary = summarizeReconciliation({
      statementEndingBalance: 300,
      openingBalance: 500,
      bookBalance: 300,
      direction: 'CREDIT',
      transactions: [
        { amount: 200, cleared: true },
        { amount: 75, cleared: false },
      ],
    });

    expect(summary).toMatchObject({
      clearedTotal: -200,
      clearedBalance: 300,
      difference: 0,
      balanced: true,
      clearedCount: 1,
    });
  });
});
