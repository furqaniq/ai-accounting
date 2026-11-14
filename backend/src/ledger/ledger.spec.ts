import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.factory';
import { PrismaService } from '../prisma/prisma.service';

interface LineView {
  id: string;
  accountId: string;
  description: string | null;
  debit: number;
  credit: number;
  account: { id: string; code: string; name: string; type: string };
}

interface EntryView {
  id: string;
  reference: string;
  date: string;
  memo: string | null;
  sourceType: string;
  reversedById: string | null;
  reversalOfId: string | null;
  lines: LineView[];
}

interface RegisterView {
  account: { id: string; code: string; name: string; type: string };
  openingBalance: number;
  closingBalance: number;
  totalDebit: number;
  totalCredit: number;
  lines: Array<{
    entryId: string;
    reference: string;
    date: string;
    memo: string | null;
    debit: number;
    credit: number;
    runningBalance: number;
  }>;
}

describe('Ledger engine and register', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let accountantToken: string;
  let staffToken: string;
  let viewerToken: string;
  let nimbusOwnerToken: string;
  let acmeId: string;
  let nimbusId: string;
  let cash: { id: string; code: string };
  let sales: { id: string; code: string };
  let nimbusCash: { id: string; code: string };
  let inactiveAccount: { id: string; code: string };
  let initialCashBalance = 0;
  const TEST_MEMO = 'TEST ledger entry';
  const TEST_DATES = { first: '2031-03-01', second: '2031-03-05', outside: '2031-02-01' };

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'Passw0rd!2026' })
      .expect(200);
    return res.body.accessToken;
  }

  function call(
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    token: string,
    orgId: string,
  ) {
    return request(app.getHttpServer())[method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', orgId);
  }

  async function listAccounts(token: string, orgId: string) {
    const res = await call('get', '/accounts', token, orgId).expect(200);
    return res.body.accounts as Array<{ id: string; code: string; active: boolean }>;
  }

  async function register(token: string, orgId: string, accountId: string, query = '') {
    const res = await call(
      'get',
      `/ledger/register?accountId=${accountId}${query}`,
      token,
      orgId,
    ).expect(200);
    return res.body as RegisterView;
  }

  async function postEntry(
    token: string,
    orgId: string,
    input: Record<string, unknown>,
  ): Promise<EntryView> {
    const res = await call('post', '/journal-entries', token, orgId).send(input);
    if (res.status !== 201) console.log('POST /journal-entries', res.status, JSON.stringify(res.body));
    expect(res.status).toBe(201);
    return res.body as EntryView;
  }

  async function clearTestEntries(): Promise<void> {
    const existing = await prisma.journalEntry.findMany({
      where: { memo: { startsWith: 'TEST ' } },
      select: { id: true },
    });
    const ids = existing.map((entry) => entry.id);
    if (ids.length > 0) {
      await prisma.journalEntry.deleteMany({
        where: { OR: [{ reversalOfId: { in: ids } }, { sourceId: { in: ids } }] },
      });
      await prisma.journalEntry.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.account.deleteMany({ where: { code: '7901' } });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    prisma = moduleRef.get(PrismaService);
    await clearTestEntries();

    [ownerToken, accountantToken, staffToken, viewerToken, nimbusOwnerToken] = await Promise.all([
      login('owner@acme.test'),
      login('accountant@acme.test'),
      login('staff@acme.test'),
      login('viewer@acme.test'),
      login('owner@nimbus.test'),
    ]);

    const me = await call('get', '/auth/me', ownerToken, '').expect(200);
    acmeId = me.body.memberships.find(
      (m: { organizationName: string }) => m.organizationName === 'Acme Services Co.',
    ).organizationId;
    nimbusId = me.body.memberships.find(
      (m: { organizationName: string }) => m.organizationName === 'Nimbus Retail LLC',
    ).organizationId;

    const acmeAccounts = await listAccounts(accountantToken, acmeId);
    cash = acmeAccounts.find((account) => account.code === '1000')!;
    sales = acmeAccounts.find((account) => account.code === '4000')!;
    initialCashBalance = (await register(accountantToken, acmeId, cash.id)).closingBalance;
    const nimbusAccounts = await listAccounts(nimbusOwnerToken, nimbusId);
    nimbusCash = nimbusAccounts.find((account) => account.code === '1000')!;

    const created = await call('post', '/accounts', accountantToken, acmeId)
      .send({ code: '7901', name: 'Retired expense', type: 'EXPENSE' })
      .expect(201);
    inactiveAccount = { id: created.body.id, code: '7901' };
    await call('patch', `/accounts/${inactiveAccount.id}`, accountantToken, acmeId)
      .send({ active: false })
      .expect(200);
  });

  afterAll(async () => {
    await clearTestEntries();
    await app.close();
  });

  it('posts a balanced manual entry and lists it with its lines', async () => {
    const entry = await postEntry(accountantToken, acmeId, {
      date: TEST_DATES.first,
      memo: TEST_MEMO,
      lines: [
        { accountId: cash.id, debit: 250, description: 'Desk deposit' },
        { accountId: sales.id, credit: 250, description: 'Consulting income' },
      ],
    });

    expect(entry.reference).toMatch(/^JE-\d{4}$/);
    expect(entry).toMatchObject({
      date: TEST_DATES.first,
      memo: TEST_MEMO,
      sourceType: 'MANUAL',
      reversedById: null,
    });
    expect(entry.lines).toHaveLength(2);
    expect(entry.lines.find((line) => line.accountId === cash.id)).toMatchObject({
      debit: 250,
      credit: 0,
    });
    expect(entry.lines.find((line) => line.accountId === sales.id)).toMatchObject({
      debit: 0,
      credit: 250,
    });

    const listed = await call(
      'get',
      `/journal-entries?from=${TEST_DATES.first}&to=${TEST_DATES.first}`,
      accountantToken,
      acmeId,
    ).expect(200);
    expect(
      (listed.body.entries as EntryView[]).some((row) => row.id === entry.id),
    ).toBe(true);

    const detail = await call('get', `/journal-entries/${entry.id}`, viewerToken, acmeId).expect(
      200,
    );
    expect(detail.body.id).toBe(entry.id);
    expect(detail.body.lines).toHaveLength(2);
  });

  it('rejects unbalanced, empty, invalid, and foreign lines before saving', async () => {
    const before = await prisma.journalEntry.count({ where: { organizationId: acmeId } });

    const cases: Array<Record<string, unknown>> = [
      {
        date: TEST_DATES.first,
        memo: 'TEST unbalanced',
        lines: [
          { accountId: cash.id, debit: 100 },
          { accountId: sales.id, credit: 90 },
        ],
      },
      {
        date: TEST_DATES.first,
        memo: 'TEST single line',
        lines: [{ accountId: cash.id, debit: 100 }],
      },
      {
        date: TEST_DATES.first,
        memo: 'TEST empty lines',
        lines: [],
      },
      {
        date: TEST_DATES.first,
        memo: 'TEST both sides',
        lines: [
          { accountId: cash.id, debit: 100, credit: 100 },
          { accountId: sales.id, credit: 100 },
        ],
      },
      {
        date: TEST_DATES.first,
        memo: 'TEST zero line',
        lines: [
          { accountId: cash.id, debit: 0 },
          { accountId: sales.id, credit: 0 },
        ],
      },
      {
        date: TEST_DATES.first,
        memo: 'TEST negative',
        lines: [
          { accountId: cash.id, debit: -100 },
          { accountId: sales.id, credit: -100 },
        ],
      },
      {
        date: '2031-02-31',
        memo: 'TEST bad date',
        lines: [
          { accountId: cash.id, debit: 100 },
          { accountId: sales.id, credit: 100 },
        ],
      },
      {
        date: TEST_DATES.first,
        memo: 'TEST inactive',
        lines: [
          { accountId: inactiveAccount.id, debit: 100 },
          { accountId: sales.id, credit: 100 },
        ],
      },
      {
        date: TEST_DATES.first,
        memo: 'TEST foreign account',
        lines: [
          { accountId: nimbusCash.id, debit: 100 },
          { accountId: sales.id, credit: 100 },
        ],
      },
    ];

    for (const body of cases) {
      const res = await call('post', '/journal-entries', accountantToken, acmeId).send(body);
      expect(res.status).toBe(400);
    }

    const after = await prisma.journalEntry.count({ where: { organizationId: acmeId } });
    expect(after).toBe(before);
  });

  it('keeps a running balance per account and filters the register by date', async () => {
    const opening = await register(accountantToken, acmeId, cash.id);
    const baseline = opening.closingBalance;

    await postEntry(accountantToken, acmeId, {
      date: TEST_DATES.first,
      memo: TEST_MEMO,
      lines: [
        { accountId: cash.id, debit: 120 },
        { accountId: sales.id, credit: 120 },
      ],
    });
    await postEntry(accountantToken, acmeId, {
      date: TEST_DATES.second,
      memo: TEST_MEMO,
      lines: [
        { accountId: cash.id, debit: 80 },
        { accountId: sales.id, credit: 80 },
      ],
    });

    const full = await register(accountantToken, acmeId, cash.id);
    expect(full.closingBalance).toBe(baseline + 200);

    const window = await register(
      accountantToken,
      acmeId,
      cash.id,
      `&from=${TEST_DATES.second}&to=${TEST_DATES.second}`,
    );
    expect(window.openingBalance).toBe(baseline + 120);
    expect(window.totalDebit).toBe(80);
    expect(window.totalCredit).toBe(0);
    expect(window.lines).toHaveLength(1);
    expect(window.lines[0]).toMatchObject({
      date: TEST_DATES.second,
      debit: 80,
      runningBalance: baseline + 200,
    });
    expect(window.closingBalance).toBe(baseline + 200);

    const early = await register(
      accountantToken,
      acmeId,
      cash.id,
      `&to=${TEST_DATES.outside}`,
    );
    expect(early.lines.every((line) => line.date <= TEST_DATES.outside)).toBe(true);
    expect(early.closingBalance).toBe(initialCashBalance);
  });

  it('reverses an entry without editing history and restores the balance', async () => {
    const before = (await register(accountantToken, acmeId, cash.id)).closingBalance;

    const entry = await postEntry(accountantToken, acmeId, {
      date: TEST_DATES.first,
      memo: TEST_MEMO,
      lines: [
        { accountId: cash.id, debit: 300 },
        { accountId: sales.id, credit: 300 },
      ],
    });

    const afterPost = (await register(accountantToken, acmeId, cash.id)).closingBalance;
    expect(afterPost).toBe(before + 300);

    const reversed = await call(
      'post',
      `/journal-entries/${entry.id}/reverse`,
      accountantToken,
      acmeId,
    )
      .send({ memo: 'TEST reversal' })
      .expect(201);
    expect(reversed.body).toMatchObject({
      sourceType: 'REVERSAL',
      reversalOfId: entry.id,
      memo: 'TEST reversal',
    });

    const afterReversal = (await register(accountantToken, acmeId, cash.id)).closingBalance;
    expect(afterReversal).toBe(before);

    const original = await call('get', `/journal-entries/${entry.id}`, accountantToken, acmeId)
      .expect(200);
    expect(original.body.reversedById).toBe(reversed.body.id);
    expect(original.body.lines).toHaveLength(2);

    await call('post', `/journal-entries/${entry.id}/reverse`, accountantToken, acmeId)
      .send({})
      .expect(409);
    await call('post', `/journal-entries/${reversed.body.id}/reverse`, accountantToken, acmeId)
      .send({})
      .expect(400);
  });

  it('scopes journal entries and registers to the active organization', async () => {
    const entry = await postEntry(accountantToken, acmeId, {
      date: TEST_DATES.first,
      memo: TEST_MEMO,
      lines: [
        { accountId: cash.id, debit: 40 },
        { accountId: sales.id, credit: 40 },
      ],
    });

    await call('get', `/journal-entries/${entry.id}`, nimbusOwnerToken, nimbusId).expect(404);
    await call('get', `/ledger/register?accountId=${cash.id}`, nimbusOwnerToken, nimbusId).expect(
      404,
    );

    const nimbusList = await call(
      'get',
      `/journal-entries?from=${TEST_DATES.first}&to=${TEST_DATES.first}`,
      nimbusOwnerToken,
      nimbusId,
    ).expect(200);
    expect(
      (nimbusList.body.entries as EntryView[]).some((row) => row.id === entry.id),
    ).toBe(false);

    const nimbusSales = (await listAccounts(nimbusOwnerToken, nimbusId)).find(
      (account) => account.code === '4000',
    )!;
    const nimbusEntry = await postEntry(nimbusOwnerToken, nimbusId, {
      date: TEST_DATES.first,
      memo: 'TEST nimbus entry',
      lines: [
        { accountId: nimbusCash.id, debit: 25 },
        { accountId: nimbusSales.id, credit: 25 },
      ],
    });
    const nimbusRegister = await register(nimbusOwnerToken, nimbusId, nimbusCash.id);
    expect(nimbusRegister.closingBalance).toBeGreaterThanOrEqual(25);

    const acmeList = await call(
      'get',
      `/journal-entries?from=${TEST_DATES.first}&to=${TEST_DATES.first}`,
      accountantToken,
      acmeId,
    ).expect(200);
    expect(
      (acmeList.body.entries as EntryView[]).some((row) => row.id === nimbusEntry.id),
    ).toBe(false);
  });

  it('lets staff and viewers read the ledger but not post, and audits posting', async () => {
    const read = await call('get', '/journal-entries', staffToken, acmeId).expect(200);
    expect(Array.isArray(read.body.entries)).toBe(true);
    await call('get', `/ledger/register?accountId=${cash.id}`, viewerToken, acmeId).expect(200);

    const denied = await call('post', '/journal-entries', staffToken, acmeId)
      .send({
        date: TEST_DATES.first,
        memo: 'TEST staff post',
        lines: [
          { accountId: cash.id, debit: 50 },
          { accountId: sales.id, credit: 50 },
        ],
      })
      .expect(403);
    expect(denied.body.message).toBeDefined();
    await call('post', '/journal-entries', viewerToken, acmeId)
      .send({
        date: TEST_DATES.first,
        memo: 'TEST viewer post',
        lines: [
          { accountId: cash.id, debit: 50 },
          { accountId: sales.id, credit: 50 },
        ],
      })
      .expect(403);

    const audit = await call('get', '/audit-log?entityType=JournalEntry', ownerToken, acmeId).expect(
      200,
    );
    const actions = (audit.body.entries as Array<{ action: string }>).map((row) => row.action);
    expect(actions).toEqual(
      expect.arrayContaining(['ledger.entry.post', 'ledger.entry.reverse']),
    );
  });
});
