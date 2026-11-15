import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.factory';

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

describe('Financial statements API', () => {
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
        expect.objectContaining({ code: '1000', amount: 5000 }),
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
    expect(body.cashAccounts.map((account) => account.code)).toEqual(['1000']);
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
});
