import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.factory';
import { PrismaService } from '../prisma/prisma.service';

interface ExpenseView {
  id: string;
  number: string;
  date: string;
  vendorId: string | null;
  categoryAccountId: string;
  amount: number;
  memo: string | null;
  receiptNote: string | null;
  version: number;
  vendor: { id: string; name: string } | null;
  categoryAccount: { id: string; code: string; name: string; type: string };
}

describe('Quick expenses', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let staffToken: string;
  let viewerToken: string;
  let nimbusOwnerToken: string;
  let acmeId: string;
  let nimbusId: string;
  let suppliesAccountId: string;
  let cashAccountId: string;
  let nimbusSuppliesAccountId: string;
  let brightlineId: string;
  let nimbusVendorId: string;

  const TEST_PREFIX = 'TEST EXP';

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'Passw0rd!2026' })
      .expect(200);
    return res.body.accessToken;
  }

  function call(
    method: 'get' | 'post' | 'patch',
    path: string,
    token: string,
    orgId: string,
  ) {
    return request(app.getHttpServer())[method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', orgId);
  }

  async function clearTestRows(): Promise<void> {
    const expenses = await prisma.expense.findMany({
      where: { organizationId: acmeId, memo: { startsWith: TEST_PREFIX } },
      select: { id: true },
    });
    if (expenses.length === 0) return;

    const ids = expenses.map((expense) => expense.id);
    const originals = await prisma.journalEntry.findMany({
      where: {
        organizationId: acmeId,
        sourceType: 'EXPENSE',
        OR: ids.map((id) => ({ sourceId: { startsWith: id } })),
      },
      select: { id: true },
    });
    await prisma.journalEntry.deleteMany({
      where: {
        organizationId: acmeId,
        OR: [
          ...ids.map((id) => ({ sourceType: 'EXPENSE' as const, sourceId: { startsWith: id } })),
          { sourceType: 'REVERSAL' as const, sourceId: { in: originals.map((row) => row.id) } },
        ],
      },
    });
    await prisma.expense.deleteMany({ where: { id: { in: ids } } });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    prisma = moduleRef.get(PrismaService);

    [ownerToken, staffToken, viewerToken, nimbusOwnerToken] = await Promise.all([
      login('owner@acme.test'),
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
    await clearTestRows();

    const [acmeAccounts, nimbusAccounts, acmeVendors, nimbusVendors] = await Promise.all([
      call('get', '/accounts', ownerToken, acmeId).expect(200),
      call('get', '/accounts', nimbusOwnerToken, nimbusId).expect(200),
      call('get', '/vendors', ownerToken, acmeId).expect(200),
      call('get', '/vendors', nimbusOwnerToken, nimbusId).expect(200),
    ]);

    const acmeRows = acmeAccounts.body.accounts as Array<{ id: string; code: string }>;
    const nimbusRows = nimbusAccounts.body.accounts as Array<{ id: string; code: string }>;
    suppliesAccountId = acmeRows.find((account) => account.code === '6200')!.id;
    cashAccountId = acmeRows.find((account) => account.code === '1000')!.id;
    nimbusSuppliesAccountId = nimbusRows.find((account) => account.code === '6200')!.id;
    brightlineId = (
      acmeVendors.body.vendors as Array<{ id: string; name: string }>
    ).find((vendor) => vendor.name === 'Brightline Utilities')!.id;
    nimbusVendorId = (nimbusVendors.body.vendors as Array<{ id: string; name: string }>)[0].id;
  });

  beforeEach(async () => {
    await clearTestRows();
  });

  afterAll(async () => {
    await clearTestRows();
    await app.close();
  });

  it('records a quick expense, posts balanced lines, lists it, and audits the entry', async () => {
    const created = await call('post', '/expenses', staffToken, acmeId)
      .send({
        date: '2026-11-10',
        vendorId: brightlineId,
        categoryAccountId: suppliesAccountId,
        amount: 123.45,
        memo: `${TEST_PREFIX} office supplies`,
        receiptNote: 'receipt-123.jpg',
      })
      .expect(201);

    const expense = created.body as ExpenseView;
    expect(expense.number).toMatch(/^EXP-\d{4}$/);
    expect(expense).toMatchObject({
      date: '2026-11-10',
      vendorId: brightlineId,
      categoryAccountId: suppliesAccountId,
      amount: 123.45,
      memo: `${TEST_PREFIX} office supplies`,
      receiptNote: 'receipt-123.jpg',
      version: 1,
    });
    expect(expense.vendor?.name).toBe('Brightline Utilities');
    expect(expense.categoryAccount).toMatchObject({ code: '6200', name: 'Supplies expense' });

    const entry = await prisma.journalEntry.findFirstOrThrow({
      where: { organizationId: acmeId, sourceType: 'EXPENSE', sourceId: expense.id },
      include: { lines: { include: { account: true } } },
    });
    expect(entry.memo).toContain(expense.number);
    expect(entry.memo).toContain('Brightline Utilities');
    expect(entry.lines).toHaveLength(2);
    const suppliesLine = entry.lines.find((line) => line.accountId === suppliesAccountId)!;
    const cashLine = entry.lines.find((line) => line.accountId === cashAccountId)!;
    expect(Number(suppliesLine.debit)).toBe(123.45);
    expect(Number(suppliesLine.credit)).toBe(0);
    expect(Number(cashLine.debit)).toBe(0);
    expect(Number(cashLine.credit)).toBe(123.45);

    const list = await call(
      'get',
      `/expenses?search=${encodeURIComponent(TEST_PREFIX)}&from=2026-11-01&to=2026-11-30&categoryAccountId=${suppliesAccountId}`,
      viewerToken,
      acmeId,
    ).expect(200);
    expect(list.body.expenses).toHaveLength(1);
    expect(list.body.expenses[0].id).toBe(expense.id);

    const filteredOut = await call(
      'get',
      '/expenses?from=2026-11-11&to=2026-11-30',
      viewerToken,
      acmeId,
    ).expect(200);
    expect(filteredOut.body.expenses.some((row: ExpenseView) => row.id === expense.id)).toBe(
      false,
    );

    const audit = await call(
      'get',
      '/audit-log?action=expense.create&limit=10',
      ownerToken,
      acmeId,
    ).expect(200);
    const entryAudit = audit.body.entries.find(
      (row: { entityId: string }) => row.entityId === expense.id,
    );
    expect(entryAudit).toMatchObject({
      entityType: 'Expense',
      action: 'expense.create',
      metadata: { number: expense.number, amount: 123.45 },
    });

    await call('post', '/expenses', viewerToken, acmeId)
      .send({
        date: '2026-11-10',
        categoryAccountId: suppliesAccountId,
        amount: 10,
      })
      .expect(403);
  });

  it('validates amounts, dates, categories, and vendor tenancy', async () => {
    const base = {
      date: '2026-11-10',
      vendorId: brightlineId,
      categoryAccountId: suppliesAccountId,
      amount: 25,
    };

    await call('post', '/expenses', staffToken, acmeId)
      .send({ ...base, amount: 0 })
      .expect(400);
    await call('post', '/expenses', staffToken, acmeId)
      .send({ ...base, amount: 12.345 })
      .expect(400);
    await call('post', '/expenses', staffToken, acmeId)
      .send({ ...base, date: '2026-02-30' })
      .expect(400);

    const assetCategory = await call('post', '/expenses', staffToken, acmeId)
      .send({ ...base, categoryAccountId: cashAccountId })
      .expect(400);
    expect(assetCategory.body.message).toContain('expense account');

    await call('post', '/expenses', staffToken, acmeId)
      .send({ ...base, vendorId: nimbusVendorId })
      .expect(400);
    await call('post', '/expenses', staffToken, acmeId)
      .send({ ...base, categoryAccountId: nimbusSuppliesAccountId })
      .expect(400);

    const expense = await call('post', '/expenses', staffToken, acmeId)
      .send({ ...base, memo: `${TEST_PREFIX} tenant guard` })
      .expect(201);

    await call('get', `/expenses/${expense.body.id}`, nimbusOwnerToken, nimbusId).expect(404);
    await call('patch', `/expenses/${expense.body.id}`, nimbusOwnerToken, nimbusId)
      .send({ amount: 99 })
      .expect(404);
    const nimbusList = await call('get', '/expenses', nimbusOwnerToken, nimbusId).expect(200);
    expect(
      nimbusList.body.expenses.some((row: ExpenseView) => row.id === expense.body.id),
    ).toBe(false);
  });

  it('correction-posts financial edits and leaves memo-only edits off the ledger', async () => {
    const created = await call('post', '/expenses', staffToken, acmeId)
      .send({
        date: '2026-11-05',
        vendorId: brightlineId,
        categoryAccountId: suppliesAccountId,
        amount: 100,
        memo: `${TEST_PREFIX} correction`,
      })
      .expect(201);

    const updated = await call('patch', `/expenses/${created.body.id}`, staffToken, acmeId)
      .send({ amount: 140, memo: `${TEST_PREFIX} correction resolved` })
      .expect(200);
    expect(updated.body).toMatchObject({ amount: 140, version: 2 });

    const entries = await prisma.journalEntry.findMany({
      where: {
        organizationId: acmeId,
        OR: [
          { sourceType: 'EXPENSE', sourceId: { startsWith: created.body.id } },
          { sourceType: 'REVERSAL', sourceId: { in: await originalEntryIds(created.body.id) } },
        ],
      },
      include: { lines: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(entries).toHaveLength(3);
    expect(entries.filter((entry) => entry.sourceType === 'REVERSAL')).toHaveLength(1);

    const suppliesMovement = entries
      .flatMap((entry) => entry.lines)
      .filter((line) => line.accountId === suppliesAccountId)
      .reduce((total, line) => total + Number(line.debit) - Number(line.credit), 0);
    expect(suppliesMovement).toBe(140);

    const beforeMemoEdit = entries.length;
    await call('patch', `/expenses/${created.body.id}`, staffToken, acmeId)
      .send({ memo: `${TEST_PREFIX} memo only` })
      .expect(200);
    const afterMemoEdit = await prisma.journalEntry.count({
      where: {
        organizationId: acmeId,
        sourceType: 'EXPENSE',
        sourceId: { startsWith: created.body.id },
      },
    });
    expect(afterMemoEdit).toBe(2);
    expect(entries.length).toBe(beforeMemoEdit);

    const audit = await call(
      'get',
      '/audit-log?action=expense.update&limit=10',
      ownerToken,
      acmeId,
    ).expect(200);
    expect(
      audit.body.entries.some(
        (row: { entityId: string; metadata: { corrected?: boolean } }) =>
          row.entityId === created.body.id && row.metadata.corrected === true,
      ),
    ).toBe(true);
  });

  async function originalEntryIds(expenseId: string): Promise<string[]> {
    const rows = await prisma.journalEntry.findMany({
      where: {
        organizationId: acmeId,
        sourceType: 'EXPENSE',
        sourceId: { startsWith: expenseId },
      },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }
});
