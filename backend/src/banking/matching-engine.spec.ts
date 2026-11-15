import { Prisma } from '@prisma/client';
import { ScopedDataAccess } from '../tenant/scoped-data-access.service';
import { MatchingEngine, MatchEntityType } from './matching-engine';

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(2));
}

function engineWith(rows: Record<string, unknown[]>): {
  engine: MatchingEngine;
  findMany: jest.Mock;
} {
  const findMany = jest.fn(async (model: string) => rows[model] ?? []);
  const scoped = { findMany } as unknown as ScopedDataAccess;
  return { engine: new MatchingEngine(scoped), findMany };
}

describe('MatchingEngine', () => {
  it('ranks deposits by amount, date, and description signals', async () => {
    const { engine, findMany } = engineWith({
      invoice: [
        {
          id: 'invoice-best',
          number: 'INV-2001',
          dueDate: new Date('2026-12-10T00:00:00.000Z'),
          total: decimal(300),
          amountPaid: decimal(0),
          notes: 'Implementation work',
          customer: { name: 'Northwind Studio' },
        },
        {
          id: 'invoice-near',
          number: 'INV-2002',
          dueDate: new Date('2026-12-10T00:00:00.000Z'),
          total: decimal(301),
          amountPaid: decimal(0),
          notes: 'Implementation work',
          customer: { name: 'Northwind Studio' },
        },
      ],
      payment: [
        {
          id: 'payment-third',
          number: 'PAY-2001',
          date: new Date('2026-12-13T00:00:00.000Z'),
          amount: decimal(300),
          reference: 'NORTHWIND DEPOSIT',
          notes: null,
          customer: { name: 'Northwind Studio' },
        },
      ],
    });

    const suggestions = await engine.suggest({
      date: new Date('2026-12-10T00:00:00.000Z'),
      description: 'NORTHWIND STUDIO INV-2001 DEPOSIT',
      amount: 300,
    });

    expect(suggestions.map((row) => row.entityId)).toEqual([
      'invoice-best',
      'invoice-near',
      'payment-third',
    ]);
    expect(suggestions[0]).toMatchObject({
      entityType: MatchEntityType.INVOICE,
      number: 'INV-2001',
      score: 110,
      rank: 1,
      daysFromTransaction: 0,
      reasons: [
        'Amount matches exactly',
        'Same day',
        'Description mentions INV-2001',
      ],
    });
    expect(suggestions[1]).toMatchObject({
      score: 85,
      reasons: expect.arrayContaining(['Amount is $1.00 off']),
    });
    expect(suggestions[2]).toMatchObject({
      entityType: MatchEntityType.PAYMENT,
      score: 83,
      daysFromTransaction: 3,
    });
    expect(suggestions.map((row) => row.entityType)).not.toContain(
      MatchEntityType.BILL,
    );
    expect(findMany.mock.calls.map((call) => call[0]).sort()).toEqual([
      'invoice',
      'payment',
    ]);
  });

  it('ranks withdrawals against open bills and expenses only', async () => {
    const { engine, findMany } = engineWith({
      bill: [
        {
          id: 'bill-best',
          number: 'BILL-2001',
          dueDate: new Date('2026-12-12T00:00:00.000Z'),
          total: decimal(432),
          amountPaid: decimal(0),
          notes: 'Utilities',
          vendor: { name: 'Brightline Utilities' },
        },
        {
          id: 'bill-far',
          number: 'BILL-2002',
          dueDate: new Date('2026-11-01T00:00:00.000Z'),
          total: decimal(100),
          amountPaid: decimal(0),
          notes: 'Storage',
          vendor: { name: 'Pioneer Storage' },
        },
      ],
      expense: [
        {
          id: 'expense-third',
          number: 'EXP-2001',
          date: new Date('2026-12-13T00:00:00.000Z'),
          amount: decimal(432),
          memo: 'BRIGHTLINE UTILITIES',
          receiptNote: null,
          vendor: { name: 'Brightline Utilities' },
          categoryAccount: { code: '6100', name: 'Utilities expense' },
        },
      ],
    });

    const suggestions = await engine.suggest({
      date: new Date('2026-12-12T00:00:00.000Z'),
      description: 'BRIGHTLINE UTILITIES BILL',
      amount: -432,
    });

    expect(suggestions.map((row) => row.entityId)).toEqual([
      'bill-best',
      'expense-third',
    ]);
    expect(suggestions[0]).toMatchObject({
      entityType: MatchEntityType.BILL,
      number: 'BILL-2001',
      rank: 1,
    });
    expect(suggestions[1]).toMatchObject({
      entityType: MatchEntityType.EXPENSE,
      rank: 2,
    });
    expect(suggestions.map((row) => row.entityType)).not.toContain(
      MatchEntityType.INVOICE,
    );
    expect(findMany.mock.calls.map((call) => call[0]).sort()).toEqual([
      'bill',
      'expense',
    ]);
  });

  it('returns no suggestions for a zero-amount transaction', async () => {
    const { engine, findMany } = engineWith({});
    const suggestions = await engine.suggest({
      date: new Date('2026-12-10T00:00:00.000Z'),
      description: 'ZERO',
      amount: 0,
    });
    expect(suggestions).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
