import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.factory';
import { PrismaService } from '../prisma/prisma.service';

interface AccountRow {
  accountId: string | null;
  code: string | null;
  name: string;
  amount: number;
  synthetic?: boolean;
}

interface StatementGroup {
  key: string;
  label: string;
  accounts: AccountRow[];
  total: number;
}

interface ProfitLossBody {
  report: string;
  from: string;
  to: string;
  groups: StatementGroup[];
  totalIncome: number;
  totalExpenses: number;
  netIncome: number;
}

interface BalanceSheetBody {
  report: string;
  asOf: string;
  groups: StatementGroup[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  totalLiabilitiesAndEquity: number;
  currentEarnings: number;
  balanced: boolean;
}

interface TrialBalanceBody {
  report: string;
  asOf: string;
  rows: Array<{
    accountId: string;
    code: string;
    name: string;
    type: string;
    debit: number;
    credit: number;
  }>;
  totalDebit: number;
  totalCredit: number;
  debitsEqualCredits: boolean;
}

interface CashFlowBody {
  report: string;
  from: string;
  to: string;
  cashAccounts: Array<{ id: string; code: string; name: string }>;
  beginningCash: number;
  netChange: number;
  endingCash: number;
  groups: Array<{
    key: string;
    label: string;
    lines: Array<{ accountId: string; code: string; name: string; amount: number }>;
    total: number;
  }>;
  reconciled: boolean;
}

interface SalesSource {
  type: 'invoice';
  id: string;
  number: string;
  date: string;
  amount: number;
  quantity: number;
  tax?: number;
  total?: number;
}

interface SalesByCustomerBody {
  report: string;
  from: string;
  to: string;
  rows: Array<{
    customerId: string;
    code: string;
    name: string;
    amount: number;
    tax: number;
    total: number;
    quantity: number;
    count: number;
    sources: SalesSource[];
  }>;
  totals: { amount: number; tax: number; total: number; quantity: number; count: number };
  ledgerIncome: number;
  reconciled: boolean;
}

interface SalesByItemBody {
  report: string;
  from: string;
  to: string;
  rows: Array<{
    itemId: string;
    code: string;
    name: string;
    amount: number;
    quantity: number;
    count: number;
    sources: SalesSource[];
  }>;
  totals: { amount: number; quantity: number; count: number };
  ledgerIncome: number;
  reconciled: boolean;
}

interface ExpenseSource {
  type: 'expense' | 'bill';
  id: string;
  number: string;
  date: string;
  amount: number;
  party: string | null;
  memo: string | null;
}

interface ExpensesByCategoryBody {
  report: string;
  from: string;
  to: string;
  rows: Array<{
    accountId: string;
    code: string;
    name: string;
    amount: number;
    count: number;
    sources: ExpenseSource[];
  }>;
  totals: { amount: number; count: number };
  ledgerExpenses: number;
  reconciled: boolean;
}

describe('Financial statements API', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let viewerToken: string;
  let accountantToken: string;
  let nimbusToken: string;
  let acmeId: string;
  let nimbusId: string;
  const TEST_PREFIX = 'TEST EXP REPORT';

  async function clearTestExpenses(): Promise<void> {
    if (!acmeId) return;
    const expenses = await prisma.expense.findMany({
      where: { organizationId: acmeId, memo: { startsWith: TEST_PREFIX } },
      select: { id: true },
    });
    if (expenses.length === 0) return;
    const ids = expenses.map((expense) => expense.id);
    const originals = await prisma.journalEntry.findMany({
      where: { organizationId: acmeId, sourceType: 'EXPENSE', sourceId: { in: ids } },
      select: { id: true },
    });
    await prisma.journalEntry.deleteMany({
      where: {
        organizationId: acmeId,
        OR: [
          ...ids.map((id) => ({ sourceType: 'EXPENSE' as const, sourceId: id })),
          { sourceType: 'REVERSAL' as const, sourceId: { in: originals.map((row) => row.id) } },
        ],
      },
    });
    await prisma.expense.deleteMany({ where: { id: { in: ids } } });
  }

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'Passw0rd!2026' })
      .expect(200);
    return res.body.accessToken;
  }

  function get(path: string, token: string, orgId: string) {
    return request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', orgId);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    prisma = moduleRef.get(PrismaService);

    [ownerToken, viewerToken, accountantToken, nimbusToken] = await Promise.all([
      login('owner@acme.test'),
      login('viewer@acme.test'),
      login('accountant@acme.test'),
      login('owner@nimbus.test'),
    ]);

    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    acmeId = me.body.memberships.find(
      (membership: { organizationName: string }) =>
        membership.organizationName === 'Acme Services Co.',
    ).organizationId;
    nimbusId = me.body.memberships.find(
      (membership: { organizationName: string }) =>
        membership.organizationName === 'Nimbus Retail LLC',
    ).organizationId;
    await clearTestExpenses();
  });

  afterAll(async () => {
    await clearTestExpenses();
    await app.close();
  });

  it('builds a seeded profit-and-loss statement and rejects malformed periods', async () => {
    const res = await get(
      '/reports/profit-loss?from=2026-01-01&to=2026-12-31',
      viewerToken,
      acmeId,
    ).expect(200);
    const body = res.body as ProfitLossBody;

    expect(body.report).toBe('profit-loss');
    expect(body.from).toBe('2026-01-01');
    expect(body.to).toBe('2026-12-31');
    expect(body.totalIncome).toBe(1200);
    expect(body.totalExpenses).toBe(1075);
    expect(body.netIncome).toBe(125);
    expect(body.groups.find((group) => group.key === 'income')?.accounts).toEqual([
      expect.objectContaining({ code: '4000', amount: 1200 }),
    ]);
    expect(body.groups.find((group) => group.key === 'expense')?.accounts).toEqual([
      expect.objectContaining({ code: '6100', amount: 475 }),
      expect.objectContaining({ code: '6200', amount: 600 }),
    ]);

    const empty = await get(
      '/reports/profit-loss?from=2026-11-01&to=2026-11-30',
      ownerToken,
      acmeId,
    ).expect(200);
    expect(empty.body.totalIncome).toBe(0);
    expect(empty.body.totalExpenses).toBe(0);
    expect(empty.body.netIncome).toBe(0);

    await get('/reports/profit-loss?from=2026-13-01', ownerToken, acmeId).expect(400);
    await get('/reports/profit-loss?from=2026-02-30', ownerToken, acmeId).expect(400);
    await get('/reports/profit-loss?from=2026-12-01&to=2026-01-01', ownerToken, acmeId).expect(
      400,
    );
  });

  it('defaults an omitted period start to the fiscal year and echoes the effective range', async () => {
    const res = await get('/reports/profit-loss?to=2026-12-31', ownerToken, acmeId).expect(200);
    expect(res.body.from).toBe('2026-01-01');
    expect(res.body.to).toBe('2026-12-31');
    expect(res.body.totalIncome).toBe(1200);
  });

  it('balances a seeded balance sheet by folding current earnings into equity', async () => {
    const res = await get(
      '/reports/balance-sheet?asOf=2026-12-31',
      viewerToken,
      acmeId,
    ).expect(200);
    const body = res.body as BalanceSheetBody;

    expect(body.report).toBe('balance-sheet');
    expect(body.asOf).toBe('2026-12-31');
    expect(body.totalAssets).toBe(6323.75);
    expect(body.totalLiabilities).toBe(1198.75);
    expect(body.currentEarnings).toBe(125);
    expect(body.totalEquity).toBe(5125);
    expect(body.totalLiabilitiesAndEquity).toBe(6323.75);
    expect(body.balanced).toBe(true);
    expect(body.groups.find((group) => group.key === 'assets')?.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: '1000', amount: 4500 }),
        expect.objectContaining({ code: '1020', amount: 500 }),
        expect.objectContaining({ code: '1100', amount: 1274.25 }),
      ]),
    );
    expect(
      body.groups
        .find((group) => group.key === 'equity')
        ?.accounts.find((account) => account.name === 'Current earnings'),
    ).toEqual(expect.objectContaining({ accountId: null, amount: 125, synthetic: true }));

    const beforeActivity = await get(
      '/reports/balance-sheet?asOf=2026-09-14',
      ownerToken,
      acmeId,
    ).expect(200);
    expect(beforeActivity.body.totalAssets).toBe(5000);
    expect(beforeActivity.body.totalLiabilities).toBe(0);
    expect(beforeActivity.body.currentEarnings).toBe(0);
    expect(beforeActivity.body.balanced).toBe(true);
  });

  it('returns a trial balance whose debits equal credits and respects the as-of boundary', async () => {
    const res = await get(
      '/reports/trial-balance?asOf=2026-12-31',
      viewerToken,
      acmeId,
    ).expect(200);
    const body = res.body as TrialBalanceBody;

    expect(body.report).toBe('trial-balance');
    expect(body.asOf).toBe('2026-12-31');
    expect(body.totalDebit).toBe(7398.75);
    expect(body.totalCredit).toBe(7398.75);
    expect(body.debitsEqualCredits).toBe(true);
    expect(body.rows.map((row) => row.code)).toEqual([
      '1000',
      '1020',
      '1100',
      '1300',
      '2000',
      '2100',
      '3000',
      '4000',
      '6100',
      '6200',
    ]);

    const before = await get(
      '/reports/trial-balance?asOf=2026-09-14',
      ownerToken,
      acmeId,
    ).expect(200);
    expect(before.body.totalDebit).toBe(5000);
    expect(before.body.totalCredit).toBe(5000);
    expect(before.body.rows.map((row: { code: string }) => row.code)).toEqual(['1000', '3000']);

    const boundary = await get(
      '/reports/trial-balance?asOf=2026-09-15',
      ownerToken,
      acmeId,
    ).expect(200);
    expect(boundary.body.totalDebit).toBe(6449.25);
    expect(boundary.body.totalCredit).toBe(6449.25);
    expect(boundary.body.debitsEqualCredits).toBe(true);
  });

  it('explains cash movements by counterpart and reconciles beginning plus movement to ending cash', async () => {
    const res = await get(
      '/reports/cash-flow?from=2026-01-01&to=2026-12-31',
      viewerToken,
      acmeId,
    ).expect(200);
    const body = res.body as CashFlowBody;

    expect(body.report).toBe('cash-flow');
    expect(body.cashAccounts.map((account) => account.code)).toEqual(['1000', '1020']);
    expect(body.beginningCash).toBe(0);
    expect(body.netChange).toBe(5000);
    expect(body.endingCash).toBe(5000);
    expect(body.reconciled).toBe(true);
    expect(body.groups.find((group) => group.key === 'financing')?.lines).toEqual([
      expect.objectContaining({ code: '3000', amount: 5000 }),
    ]);
    expect(body.groups.find((group) => group.key === 'operating')?.lines).toHaveLength(0);

    const prior = await get(
      '/reports/cash-flow?from=2026-02-01&to=2026-12-31',
      ownerToken,
      acmeId,
    ).expect(200);
    expect(prior.body.beginningCash).toBe(5000);
    expect(prior.body.netChange).toBe(0);
    expect(prior.body.endingCash).toBe(5000);
    expect(prior.body.groups.every((group: { lines: unknown[] }) => group.lines.length === 0)).toBe(
      true,
    );
  });

  it('is tenant scoped and readable by every role with reports:read', async () => {
    const nimbus = await get(
      '/reports/profit-loss?from=2026-01-01&to=2026-12-31',
      nimbusToken,
      nimbusId,
    ).expect(200);
    expect(nimbus.body.totalIncome).toBe(240);
    expect(nimbus.body.totalExpenses).toBe(300);
    expect(nimbus.body.netIncome).toBe(-60);

    await get(
      '/reports/profit-loss?from=2026-01-01&to=2026-12-31',
      accountantToken,
      nimbusId,
    ).expect(403);

    await get(
      '/reports/trial-balance?asOf=2026-12-31',
      viewerToken,
      acmeId,
    ).expect(200);
  });

  it('rejects an as-of that does not exist in the calendar', async () => {
    await get('/reports/balance-sheet?asOf=2026-02-30', ownerToken, acmeId).expect(400);
    await get('/reports/trial-balance?asOf=not-a-date', ownerToken, acmeId).expect(400);
  });

  it('reports sales by customer from posted invoices and respects date boundaries', async () => {
    const res = await get(
      '/reports/sales-by-customer?from=2026-01-01&to=2026-12-31',
      viewerToken,
      acmeId,
    ).expect(200);
    const body = res.body as SalesByCustomerBody;

    expect(body.report).toBe('sales-by-customer');
    expect(body.from).toBe('2026-01-01');
    expect(body.to).toBe('2026-12-31');
    expect(body.totals).toEqual({
      amount: 1200,
      tax: 74.25,
      total: 1274.25,
      quantity: 3,
      count: 2,
    });
    expect(body.ledgerIncome).toBe(1200);
    expect(body.reconciled).toBe(true);

    const northwind = body.rows.find((row) => row.code === 'CUST-0001');
    expect(northwind).toMatchObject({
      customerId: expect.any(String),
      name: 'Northwind Studio',
      amount: 300,
      tax: 0,
      total: 300,
      quantity: 2,
      count: 1,
    });
    expect(northwind?.sources).toEqual([
      {
        type: 'invoice',
        id: expect.any(String),
        number: 'INV-1001',
        date: '2026-10-20',
        amount: 300,
        tax: 0,
        total: 300,
        quantity: 2,
      },
    ]);

    const harbor = body.rows.find((row) => row.code === 'CUST-0002');
    expect(harbor).toMatchObject({
      name: 'Harbor & Pine',
      amount: 900,
      tax: 74.25,
      total: 974.25,
      quantity: 1,
      count: 1,
    });
    expect(harbor?.sources[0]).toMatchObject({ number: 'INV-1002', date: '2026-09-15' });

    const throughBoundary = await get(
      '/reports/sales-by-customer?from=2026-01-01&to=2026-09-15',
      ownerToken,
      acmeId,
    ).expect(200);
    expect(throughBoundary.body.totals.amount).toBe(900);
    expect(throughBoundary.body.rows.map((row: { code: string }) => row.code)).toEqual([
      'CUST-0002',
    ]);

    const afterBoundary = await get(
      '/reports/sales-by-customer?from=2026-09-16&to=2026-12-31',
      ownerToken,
      acmeId,
    ).expect(200);
    expect(afterBoundary.body.totals.amount).toBe(300);
    expect(afterBoundary.body.rows.map((row: { code: string }) => row.code)).toEqual([
      'CUST-0001',
    ]);

    const draftsOnly = await get(
      '/reports/sales-by-customer?from=2026-11-01&to=2026-11-30',
      ownerToken,
      acmeId,
    ).expect(200);
    expect(draftsOnly.body.rows).toEqual([]);
    expect(draftsOnly.body.totals.amount).toBe(0);

    await get(
      '/reports/sales-by-customer?from=2026-12-01&to=2026-01-01',
      ownerToken,
      acmeId,
    ).expect(400);
  });

  it('reports sales by item with quantities and posted invoice sources', async () => {
    const res = await get(
      '/reports/sales-by-item?from=2026-01-01&to=2026-12-31',
      viewerToken,
      acmeId,
    ).expect(200);
    const body = res.body as SalesByItemBody;

    expect(body.report).toBe('sales-by-item');
    expect(body.totals).toEqual({ amount: 1200, quantity: 3, count: 2 });
    expect(body.ledgerIncome).toBe(1200);
    expect(body.reconciled).toBe(true);

    const consulting = body.rows.find((row) => row.code === 'ITEM-0001');
    expect(consulting).toMatchObject({
      name: 'Consulting hour',
      amount: 300,
      quantity: 2,
      count: 1,
    });
    expect(consulting?.sources).toEqual([
      expect.objectContaining({
        type: 'invoice',
        number: 'INV-1001',
        date: '2026-10-20',
        amount: 300,
        quantity: 2,
      }),
    ]);

    const design = body.rows.find((row) => row.code === 'ITEM-0002');
    expect(design).toMatchObject({ name: 'Design package', amount: 900, quantity: 1, count: 1 });
    expect(design?.sources[0]).toMatchObject({ number: 'INV-1002' });

    const afterBoundary = await get(
      '/reports/sales-by-item?from=2026-09-16&to=2026-12-31',
      ownerToken,
      acmeId,
    ).expect(200);
    expect(afterBoundary.body.totals).toEqual({ amount: 300, quantity: 2, count: 1 });
    expect(afterBoundary.body.rows.map((row: { code: string }) => row.code)).toEqual([
      'ITEM-0001',
    ]);

    const draftsOnly = await get(
      '/reports/sales-by-item?from=2026-11-01&to=2026-11-30',
      ownerToken,
      acmeId,
    ).expect(200);
    expect(draftsOnly.body.rows).toEqual([]);
  });

  it('reports expenses by category from posted bills and quick expenses', async () => {
    const seeded = await get(
      '/reports/expenses-by-category?from=2026-01-01&to=2026-12-31',
      viewerToken,
      acmeId,
    ).expect(200);
    const seededBody = seeded.body as ExpensesByCategoryBody;

    expect(seededBody.report).toBe('expenses-by-category');
    expect(seededBody.totals).toEqual({ amount: 1075, count: 2 });
    expect(seededBody.ledgerExpenses).toBe(1075);
    expect(seededBody.reconciled).toBe(true);
    expect(seededBody.rows.map((row) => row.code)).toEqual(['6100', '6200']);
    expect(seededBody.rows[0]).toMatchObject({ name: 'Utilities expense', amount: 475, count: 1 });
    expect(seededBody.rows[0].sources).toEqual([
      {
        type: 'bill',
        id: expect.any(String),
        number: 'BILL-1002',
        date: '2026-09-15',
        amount: 475,
        party: 'Brightline Utilities',
        memo: 'Electricity',
      },
    ]);
    expect(seededBody.rows[1]).toMatchObject({ name: 'Supplies expense', amount: 600, count: 1 });
    expect(seededBody.rows[1].sources[0]).toMatchObject({ number: 'BILL-1001' });

    const accounts = await get('/accounts', ownerToken, acmeId).expect(200);
    const utilities = (accounts.body.accounts as Array<{ id: string; code: string }>).find(
      (account) => account.code === '6100',
    );
    expect(utilities).toBeDefined();

    const created = await request(app.getHttpServer())
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Organization-Id', acmeId)
      .send({
        date: '2026-10-10',
        categoryAccountId: utilities!.id,
        amount: 25,
        memo: TEST_PREFIX,
      })
      .expect(201);

    try {
      const combined = await get(
        '/reports/expenses-by-category?from=2026-01-01&to=2026-12-31',
        ownerToken,
        acmeId,
      ).expect(200);
      const combinedBody = combined.body as ExpensesByCategoryBody;
      expect(combinedBody.totals).toEqual({ amount: 1100, count: 3 });
      expect(combinedBody.ledgerExpenses).toBe(1100);
      expect(combinedBody.reconciled).toBe(true);
      expect(combinedBody.rows[0]).toMatchObject({ code: '6100', amount: 500, count: 2 });
      expect(combinedBody.rows[0].sources.map((source) => source.type).sort()).toEqual([
        'bill',
        'expense',
      ]);
      expect(combinedBody.rows[0].sources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'expense',
            id: created.body.id,
            number: created.body.number,
            date: '2026-10-10',
            amount: 25,
            memo: TEST_PREFIX,
          }),
        ]),
      );

      const october = await get(
        '/reports/expenses-by-category?from=2026-10-01&to=2026-10-31',
        ownerToken,
        acmeId,
      ).expect(200);
      expect(october.body.totals).toEqual({ amount: 625, count: 2 });
      expect(october.body.rows.map((row: { code: string }) => row.code)).toEqual([
        '6100',
        '6200',
      ]);

      const afterExpense = await get(
        '/reports/expenses-by-category?from=2026-10-11&to=2026-12-31',
        ownerToken,
        acmeId,
      ).expect(200);
      expect(afterExpense.body.totals.amount).toBe(600);
      expect(afterExpense.body.rows.map((row: { code: string }) => row.code)).toEqual(['6200']);

      const draftsOnly = await get(
        '/reports/expenses-by-category?from=2026-11-01&to=2026-11-30',
        ownerToken,
        acmeId,
      ).expect(200);
      expect(draftsOnly.body.rows).toEqual([]);
    } finally {
      await clearTestExpenses();
    }
  });

  it('keeps operational reports tenant scoped and readable by every role', async () => {
    const nimbus = await get(
      '/reports/sales-by-customer?from=2026-01-01&to=2026-12-31',
      nimbusToken,
      nimbusId,
    ).expect(200);
    expect(nimbus.body.totals).toEqual({
      amount: 240,
      tax: 19.8,
      total: 259.8,
      quantity: 2,
      count: 1,
    });
    expect(nimbus.body.ledgerIncome).toBe(240);
    expect(nimbus.body.rows[0]).toMatchObject({ code: 'CUST-0001', name: 'Cedar Market' });

    const nimbusExpenses = await get(
      '/reports/expenses-by-category?from=2026-01-01&to=2026-12-31',
      nimbusToken,
      nimbusId,
    ).expect(200);
    expect(nimbusExpenses.body.totals).toEqual({ amount: 300, count: 1 });
    expect(nimbusExpenses.body.rows[0]).toMatchObject({ code: '6200', amount: 300 });

    await get(
      '/reports/sales-by-item?from=2026-01-01&to=2026-12-31',
      accountantToken,
      nimbusId,
    ).expect(403);

    await get(
      '/reports/expenses-by-category?from=2026-01-01&to=2026-12-31',
      viewerToken,
      acmeId,
    ).expect(200);
  });
});
