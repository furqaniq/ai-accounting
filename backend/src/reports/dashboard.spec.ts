import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.factory';

interface DashboardBody {
  from: string;
  to: string;
  cash: {
    total: number;
    accounts: Array<{
      id: string;
      code: string;
      name: string;
      type: string;
      balance: number;
      netChange: number;
    }>;
  };
  receivables: { total: number; overdue: number; openCount: number };
  payables: { total: number; overdue: number; openCount: number };
  trend: {
    buckets: Array<{
      month: string;
      label: string;
      income: number;
      expenses: number;
      net: number;
    }>;
    totalIncome: number;
    totalExpenses: number;
    netIncome: number;
  };
  recentActivity: Array<{
    type: string;
    id: string;
    number: string;
    party: string | null;
    date: string;
    amount: number;
    status: string;
    href: string;
  }>;
  attention: {
    overdueInvoices: number;
    overdueBills: number;
    unmatchedBankTransactions: number;
  };
}

describe('Dashboard API', () => {
  let app: INestApplication;
  let ownerToken: string;
  let viewerToken: string;
  let accountantToken: string;
  let nimbusToken: string;
  let acmeId: string;
  let nimbusId: string;

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
  });

  afterAll(async () => {
    await app.close();
  });

  it('assembles seeded cash, AR/AP, trend, and activity for a period', async () => {
    const res = await get(
      '/dashboard?from=2026-01-01&to=2026-11-14',
      ownerToken,
      acmeId,
    ).expect(200);
    const body = res.body as DashboardBody;

    expect(body.from).toBe('2026-01-01');
    expect(body.to).toBe('2026-11-14');

    expect(body.cash.total).toBe(5000);
    expect(body.cash.accounts).toEqual([
      expect.objectContaining({
        code: '1000',
        name: 'Cash',
        type: 'ASSET',
        balance: 4500,
        netChange: 4500,
      }),
      expect.objectContaining({
        code: '1020',
        name: 'Checking account',
        type: 'ASSET',
        balance: 500,
        netChange: 500,
      }),
    ]);

    expect(body.receivables.total).toBe(1274.25);
    expect(body.receivables.overdue).toBe(974.25);
    expect(body.receivables.openCount).toBe(2);
    expect(body.payables.total).toBe(1124.5);
    expect(body.payables.overdue).toBe(475);
    expect(body.payables.openCount).toBe(2);

    expect(body.trend.totalIncome).toBe(1200);
    expect(body.trend.totalExpenses).toBe(1075);
    expect(body.trend.netIncome).toBe(125);
    expect(body.trend.buckets.find((bucket) => bucket.month === '2026-09')).toEqual(
      expect.objectContaining({ income: 900, expenses: 475, net: 425 }),
    );
    expect(body.trend.buckets.find((bucket) => bucket.month === '2026-10')).toEqual(
      expect.objectContaining({ income: 300, expenses: 600, net: -300 }),
    );

    expect(body.recentActivity).toHaveLength(4);
    expect(body.recentActivity).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'invoice',
          number: 'INV-1002',
          party: 'Harbor & Pine',
          amount: 974.25,
          href: expect.stringMatching(/^\/invoices\?invoice=/),
        }),
        expect.objectContaining({
          type: 'bill',
          number: 'BILL-1001',
          party: 'Halden Paper',
          amount: 649.5,
          href: expect.stringMatching(/^\/bills\?bill=/),
        }),
      ]),
    );

    expect(body.attention).toEqual({
      overdueInvoices: 1,
      overdueBills: 1,
      unmatchedBankTransactions: 0,
    });
  });

  it('scopes trend and activity to the selected period and reconciles totals to the P&L', async () => {
    const period = { from: '2026-10-16', to: '2026-11-14' };
    const [dashboard, profitLoss] = await Promise.all([
      get(`/dashboard?from=${period.from}&to=${period.to}`, ownerToken, acmeId).expect(200),
      get(`/reports/profit-loss?from=${period.from}&to=${period.to}`, ownerToken, acmeId).expect(
        200,
      ),
    ]);
    const body = dashboard.body as DashboardBody;

    expect(body.trend.totalIncome).toBe(profitLoss.body.totalIncome);
    expect(body.trend.totalExpenses).toBe(profitLoss.body.totalExpenses);
    expect(body.trend.netIncome).toBe(profitLoss.body.netIncome);
    expect(body.trend.totalIncome).toBe(300);
    expect(body.trend.totalExpenses).toBe(600);

    expect(body.cash.accounts[0].netChange).toBe(0);
    expect(body.recentActivity.map((row) => row.number).sort()).toEqual([
      'BILL-1001',
      'INV-1001',
    ]);
  });

  it('returns usable zeros and an empty activity list for an empty period', async () => {
    const res = await get(
      '/dashboard?from=2026-11-01&to=2026-11-14',
      ownerToken,
      acmeId,
    ).expect(200);
    const body = res.body as DashboardBody;

    expect(body.trend.totalIncome).toBe(0);
    expect(body.trend.totalExpenses).toBe(0);
    expect(body.trend.netIncome).toBe(0);
    expect(body.trend.buckets.every((bucket) => bucket.income === 0)).toBe(true);
    expect(body.recentActivity).toEqual([]);
    expect(body.cash.accounts[0].netChange).toBe(0);
    expect(body.receivables.total).toBe(1274.25);
  });

  it('is tenant scoped and readable by every role with reports:read', async () => {
    const nimbus = await get(
      '/dashboard?from=2026-01-01&to=2026-11-14',
      nimbusToken,
      nimbusId,
    ).expect(200);
    const body = nimbus.body as DashboardBody;
    expect(body.cash.total).toBe(3200);
    expect(body.receivables.total).toBe(259.8);
    expect(body.payables.total).toBe(324.75);
    expect(body.trend.totalIncome).toBe(240);
    expect(body.trend.totalExpenses).toBe(300);
    expect(body.recentActivity.map((row) => row.number).sort()).toEqual([
      'BILL-1001',
      'INV-1001',
    ]);

    await get('/dashboard?from=2026-01-01&to=2026-11-14', viewerToken, acmeId).expect(200);
    await get('/dashboard?from=2026-01-01&to=2026-11-14', accountantToken, acmeId).expect(200);

    await get('/dashboard?from=2026-01-01&to=2026-11-14', accountantToken, nimbusId).expect(403);
    await get('/dashboard?from=2026-01-01&to=2026-11-14', nimbusToken, acmeId).expect(403);
  });

  it('rejects malformed or inverted periods', async () => {
    await get('/dashboard?from=2026-13-01', ownerToken, acmeId).expect(400);
    await get('/dashboard?from=2026-02-30', ownerToken, acmeId).expect(400);
    await get('/dashboard?from=2026-12-01&to=2026-01-01', ownerToken, acmeId).expect(400);
  });
});
