import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import request from 'supertest';
import { AppModule } from './app.module';
import { configureApp } from './app.factory';

jest.setTimeout(120_000);

const PASSWORD = 'Passw0rd!2026';
const ORGANIZATIONS = ['Acme Services Co.', 'Nimbus Retail LLC'] as const;
const EMAILS = [
  'owner@acme.test',
  'accountant@acme.test',
  'staff@acme.test',
  'viewer@acme.test',
  'owner@nimbus.test',
  'accountant@nimbus.test',
];

interface Membership {
  organizationId: string;
  organizationName: string;
  role: string;
}

interface BankAccountRow {
  id: string;
  name: string;
  type: string;
  ledgerAccount: { code: string; name: string };
  transactionCount: number;
}

interface TransactionRow {
  description: string;
  amount: number;
  matchState: string;
  categoryAccount: { code: string } | null;
  reconciliationSessionId: string | null;
  clearedAt: string | null;
}

interface SessionRow {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  difference: number;
  balanced: boolean;
  clearedTotal: number;
}

interface AutomationRow {
  name: string;
  mode: string;
  cron: string;
  timezone: string;
  enabled: boolean;
}

function runSeed(): void {
  const backendRoot = join(__dirname, '..');
  execFileSync(
    process.execPath,
    [
      require.resolve('ts-node/dist/bin.js'),
      '--transpile-only',
      join(backendRoot, 'prisma', 'seed.ts'),
    ],
    {
      cwd: backendRoot,
      env: {
        ...process.env,
        AGENT_QUEUE_DRIVER: 'inline',
        AI_PROVIDER: 'stub',
      },
      stdio: 'pipe',
    },
  );
}

describe('Demo seed smoke test', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let orgIds: Record<string, string>;
  let tokens: Record<string, string>;

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return res.body.accessToken as string;
  }

  function get(path: string, email: string, orgId: string) {
    return request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set('Authorization', `Bearer ${tokens[email]}`)
      .set('X-Organization-Id', orgId);
  }

  async function bankAccountFor(orgId: string, email: string): Promise<BankAccountRow> {
    const res = await get('/bank-accounts', email, orgId).expect(200);
    const accounts = res.body.bankAccounts as BankAccountRow[];
    const account = accounts.find((row) => row.name === 'Operating checking');
    expect(account).toBeTruthy();
    return account!;
  }

  beforeAll(async () => {
    runSeed();
    runSeed();

    prisma = new PrismaClient();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();

    tokens = {};
    orgIds = {};
    for (const email of EMAILS) {
      tokens[email] = await login(email);
      const me = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokens[email]}`)
        .expect(200);
      for (const membership of me.body.memberships as Membership[]) {
        orgIds[membership.organizationName] = membership.organizationId;
      }
    }
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('is deterministic and safe to rerun without duplicating seeded records', async () => {
    const organizationIds = Object.values(orgIds).filter((id, index, all) =>
      all.indexOf(id) === index,
    );
    expect(organizationIds).toHaveLength(2);

    const users = await prisma.user.findMany({ where: { email: { in: EMAILS } } });
    expect(users).toHaveLength(EMAILS.length);

    const checkingAccounts = await prisma.account.findMany({
      where: { organizationId: { in: organizationIds }, code: '1020' },
    });
    expect(checkingAccounts).toHaveLength(2);

    const bankAccounts = await prisma.bankAccount.findMany({
      where: { organizationId: { in: organizationIds }, name: 'Operating checking' },
    });
    expect(bankAccounts).toHaveLength(2);

    const batches = await prisma.bankImportBatch.findMany({
      where: {
        organizationId: { in: organizationIds },
        filename: 'demo-checking-october.csv',
      },
    });
    expect(batches).toHaveLength(2);

    const transactions = await prisma.bankTransaction.findMany({
      where: {
        organizationId: { in: organizationIds },
        externalId: { startsWith: 'DEMO-' },
      },
    });
    expect(transactions).toHaveLength(4);
    expect(await prisma.reconciliationSession.count({
      where: { bankAccountId: { in: bankAccounts.map((row) => row.id) } },
    })).toBe(2);
    expect(await prisma.agentAutomation.count({
      where: {
        organizationId: { in: organizationIds },
        name: 'Weekly cash review',
      },
    })).toBe(2);

    const transfers = await prisma.journalEntry.findMany({
      where: { organizationId: { in: organizationIds }, memo: 'Seed transfer to checking' },
    });
    expect(transfers).toHaveLength(2);

    const bankEntries = await prisma.journalEntry.count({
      where: {
        organizationId: { in: organizationIds },
        sourceType: 'BANK',
        sourceId: { in: transactions.map((row) => row.id) },
      },
    });
    expect(bankEntries).toBe(4);
  });

  it('signs in every documented demo account in both organizations', async () => {
    const expected: Record<string, Array<{ organizationName: string; role: string }>> = {
      'owner@acme.test': [
        { organizationName: 'Acme Services Co.', role: 'OWNER' },
        { organizationName: 'Nimbus Retail LLC', role: 'ACCOUNTANT' },
      ],
      'accountant@acme.test': [
        { organizationName: 'Acme Services Co.', role: 'ACCOUNTANT' },
      ],
      'staff@acme.test': [{ organizationName: 'Acme Services Co.', role: 'STAFF' }],
      'viewer@acme.test': [{ organizationName: 'Acme Services Co.', role: 'VIEWER' }],
      'owner@nimbus.test': [{ organizationName: 'Nimbus Retail LLC', role: 'OWNER' }],
      'accountant@nimbus.test': [
        { organizationName: 'Nimbus Retail LLC', role: 'ACCOUNTANT' },
      ],
    };

    for (const email of EMAILS) {
      const me = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokens[email]}`)
        .expect(200);
      const memberships = me.body.memberships as Membership[];
      expect(memberships.map(({ organizationName, role }) => ({ organizationName, role }))).toEqual(
        expect.arrayContaining(expected[email]),
      );
    }
  });

  it('gives each organization its distinguishing customers, bank period, and automation', async () => {
    const acmeId = orgIds['Acme Services Co.'];
    const nimbusId = orgIds['Nimbus Retail LLC'];

    const acmeCustomers = await get('/customers', 'owner@acme.test', acmeId).expect(200);
    expect(acmeCustomers.body.customers.map((row: { name: string }) => row.name)).toEqual(
      expect.arrayContaining(['Northwind Studio', 'Harbor & Pine']),
    );
    const nimbusCustomers = await get('/customers', 'owner@nimbus.test', nimbusId).expect(200);
    expect(nimbusCustomers.body.customers.map((row: { name: string }) => row.name)).toEqual(
      expect.arrayContaining(['Cedar Market']),
    );

    const acmeBank = await bankAccountFor(acmeId, 'owner@acme.test');
    expect(acmeBank).toMatchObject({
      name: 'Operating checking',
      type: 'CHECKING',
      ledgerAccount: { code: '1020', name: 'Checking account' },
      transactionCount: 2,
    });
    const nimbusBank = await bankAccountFor(nimbusId, 'owner@nimbus.test');
    expect(nimbusBank.ledgerAccount.code).toBe('1020');

    const acmeTransactions = await get(
      `/bank-transactions?bankAccountId=${acmeBank.id}`,
      'owner@acme.test',
      acmeId,
    ).expect(200);
    expect(
      (acmeTransactions.body.transactions as TransactionRow[]).map((row) => row.description).sort(),
    ).toEqual(['NORTHWIND PAYMENT', 'NORTHWIND REFUND']);
    expect(
      (acmeTransactions.body.transactions as TransactionRow[]).every(
        (row) =>
          row.matchState === 'CATEGORIZED' &&
          row.categoryAccount?.code === '1100' &&
          row.reconciliationSessionId !== null &&
          row.clearedAt !== null,
      ),
    ).toBe(true);

    const nimbusTransactions = await get(
      `/bank-transactions?bankAccountId=${nimbusBank.id}`,
      'owner@nimbus.test',
      nimbusId,
    ).expect(200);
    expect(
      (nimbusTransactions.body.transactions as TransactionRow[])
        .map((row) => row.description)
        .sort(),
    ).toEqual(['CEDAR MARKET PAYMENT', 'CEDAR MARKET REFUND']);

    for (const [email, orgId, bank] of [
      ['owner@acme.test', acmeId, acmeBank],
      ['owner@nimbus.test', nimbusId, nimbusBank],
    ] as const) {
      const unmatched = await get(
        `/bank-transactions?bankAccountId=${bank.id}&matchState=UNMATCHED`,
        email,
        orgId,
      ).expect(200);
      expect(unmatched.body.transactions).toEqual([]);

      const sessions = await get(
        `/reconciliations?bankAccountId=${bank.id}`,
        email,
        orgId,
      ).expect(200);
      const session = (sessions.body.sessions as SessionRow[]).find(
        (row) => row.periodStart === '2026-10-01' && row.periodEnd === '2026-10-31',
      );
      expect(session).toMatchObject({
        status: 'COMPLETED',
        balanced: true,
        difference: 0,
        clearedTotal: 0,
      });

      const automations = await get('/agent/automations', email, orgId).expect(200);
      const automation = (automations.body.automations as AutomationRow[]).find(
        (row) => row.name === 'Weekly cash review',
      );
      expect(automation).toMatchObject({
        mode: 'CRON',
        cron: '0 9 * * 1',
        timezone: 'UTC',
        enabled: true,
      });
    }

    const invoices = await get('/invoices', 'owner@acme.test', acmeId).expect(200);
    const invoiceStatuses = new Set(
      (invoices.body.invoices as Array<{ status: string }>).map((row) => row.status),
    );
    expect(invoiceStatuses.has('SENT')).toBe(true);
    expect(invoiceStatuses.has('DRAFT')).toBe(true);

    const bills = await get('/bills', 'owner@acme.test', acmeId).expect(200);
    const billStatuses = new Set(
      (bills.body.bills as Array<{ status: string }>).map((row) => row.status),
    );
    expect(billStatuses.has('OPEN')).toBe(true);
    expect(billStatuses.has('DRAFT')).toBe(true);
  });
});
