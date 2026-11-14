import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.factory';
import { PrismaService } from '../prisma/prisma.service';

interface CustomerView {
  id: string;
  code: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  notes: string | null;
  active: boolean;
  balance: number;
}

interface ItemView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price: number;
  incomeAccountId: string;
  incomeAccount: { id: string; code: string; name: string };
  taxable: boolean;
  active: boolean;
}

interface AuditRow {
  action: string;
  entityId: string;
}

describe('Sales master data', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let accountantToken: string;
  let staffToken: string;
  let viewerToken: string;
  let nimbusOwnerToken: string;
  let acmeId: string;
  let nimbusId: string;
  let acmeIncome: { id: string; code: string };
  let acmeExpense: { id: string; code: string };
  let nimbusIncome: { id: string; code: string };
  let customerId: string;
  let itemId: string;

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

  async function accounts(token: string, orgId: string) {
    const res = await call('get', '/accounts', token, orgId).expect(200);
    return res.body.accounts as Array<{ id: string; code: string; type: string }>;
  }

  async function clearTestRows(): Promise<void> {
    await prisma.item.deleteMany({ where: { name: { startsWith: 'TEST ' } } });
    await prisma.customer.deleteMany({ where: { name: { startsWith: 'TEST ' } } });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    prisma = moduleRef.get(PrismaService);
    await clearTestRows();

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

    const acmeAccounts = await accounts(accountantToken, acmeId);
    acmeIncome = acmeAccounts.find((account) => account.code === '4000')!;
    acmeExpense = acmeAccounts.find((account) => account.code === '6000')!;
    nimbusIncome = (await accounts(nimbusOwnerToken, nimbusId)).find(
      (account) => account.code === '4000',
    )!;
  });

  afterAll(async () => {
    await clearTestRows();
    await app.close();
  });

  it('creates a customer with generated code, contact details, and a derived balance', async () => {
    const res = await call('post', '/customers', staffToken, acmeId)
      .send({
        name: 'TEST Customer One',
        contactName: 'Terry Test',
        email: 'terry@test.example',
        phone: '555-0100',
        addressLine1: '12 Test Lane',
        city: 'Portland',
        region: 'OR',
        postalCode: '97205',
        country: 'United States',
        notes: 'Prefers email',
      })
      .expect(201);

    customerId = res.body.id;
    expect(res.body).toMatchObject({
      name: 'TEST Customer One',
      contactName: 'Terry Test',
      email: 'terry@test.example',
      city: 'Portland',
      active: true,
      balance: 0,
    });
    expect(res.body.code).toMatch(/^CUST-\d{4}$/);

    const second = await call('post', '/customers', accountantToken, acmeId)
      .send({ name: 'TEST Customer Two' })
      .expect(201);
    expect(second.body.code).not.toBe(res.body.code);

    const listed = await call('get', '/customers?search=terry@test.example', staffToken, acmeId)
      .expect(200);
    expect(
      (listed.body.customers as CustomerView[]).some((row) => row.id === customerId),
    ).toBe(true);

    const detail = await call('get', `/customers/${customerId}`, viewerToken, acmeId).expect(200);
    expect(detail.body).toMatchObject({ id: customerId, balance: 0, phone: '555-0100' });
  });

  it('searches customers by name and keeps balances read-only', async () => {
    const byName = await call('get', '/customers?search=Customer One', ownerToken, acmeId).expect(
      200,
    );
    const names = (byName.body.customers as CustomerView[]).map((row) => row.name);
    expect(names).toContain('TEST Customer One');

    await call('patch', `/customers/${customerId}`, accountantToken, acmeId)
      .send({ balance: 500 })
      .expect(400);
    await call('post', '/customers', accountantToken, acmeId)
      .send({ name: 'TEST Bad balance', balance: 500 })
      .expect(400);
  });

  it('edits a customer and audits the change', async () => {
    const res = await call('patch', `/customers/${customerId}`, accountantToken, acmeId)
      .send({ name: 'TEST Customer Updated', phone: '555-0199', city: 'Bend', active: false })
      .expect(200);
    expect(res.body).toMatchObject({
      name: 'TEST Customer Updated',
      phone: '555-0199',
      city: 'Bend',
      active: false,
    });

    const filtered = await call('get', '/customers?active=true&search=TEST Customer', staffToken, acmeId)
      .expect(200);
    expect(
      (filtered.body.customers as CustomerView[]).some((row) => row.id === customerId),
    ).toBe(false);

    const audit = await call('get', '/audit-log?entityType=Customer', ownerToken, acmeId).expect(
      200,
    );
    const actions = (audit.body.entries as AuditRow[]).map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(['customer.create', 'customer.update']));
  });

  it('validates customer input', async () => {
    const cases = [
      {},
      { name: '' },
      { name: 'TEST Bad email', email: 'not-an-email' },
      { name: 'TEST Unknown field', website: 'https://example.test' },
      { name: 'x'.repeat(121) },
    ];
    for (const body of cases) {
      await call('post', '/customers', accountantToken, acmeId).send(body).expect(400);
    }
  });

  it('keeps customers tenant-scoped and read-only for viewers', async () => {
    const acmeList = await call('get', '/customers?search=TEST Customer', accountantToken, acmeId)
      .expect(200);
    expect((acmeList.body.customers as CustomerView[]).length).toBeGreaterThan(0);

    const nimbusList = await call('get', '/customers?search=TEST Customer', nimbusOwnerToken, nimbusId)
      .expect(200);
    expect(
      (nimbusList.body.customers as CustomerView[]).some((row) => row.id === customerId),
    ).toBe(false);
    await call('get', `/customers/${customerId}`, nimbusOwnerToken, nimbusId).expect(404);
    await call('patch', `/customers/${customerId}`, nimbusOwnerToken, nimbusId)
      .send({ name: 'Cross tenant edit' })
      .expect(404);

    await call('post', '/customers', viewerToken, acmeId)
      .send({ name: 'TEST Viewer customer' })
      .expect(403);
    await call('get', '/customers', viewerToken, acmeId).expect(200);
  });

  it('creates items with price, income account, and taxable flag', async () => {
    const res = await call('post', '/items', staffToken, acmeId)
      .send({
        name: 'TEST Item One',
        description: 'Hourly work',
        price: 125.5,
        incomeAccountId: acmeIncome.id,
        taxable: false,
      })
      .expect(201);

    itemId = res.body.id;
    expect(res.body).toMatchObject({
      name: 'TEST Item One',
      price: 125.5,
      taxable: false,
      active: true,
      incomeAccountId: acmeIncome.id,
    });
    expect(res.body.code).toMatch(/^ITEM-\d{4}$/);
    expect(res.body.incomeAccount).toMatchObject({ code: acmeIncome.code });

    const listed = await call('get', '/items?search=TEST Item', viewerToken, acmeId).expect(200);
    expect((listed.body.items as ItemView[]).some((row) => row.id === itemId)).toBe(true);
  });

  it('rejects expense, foreign, and unknown income accounts', async () => {
    const bodies = [
      { name: 'TEST Expense account', price: 10, incomeAccountId: acmeExpense.id },
      { name: 'TEST Foreign account', price: 10, incomeAccountId: nimbusIncome.id },
      { name: 'TEST Unknown account', price: 10, incomeAccountId: 'not-a-real-account' },
    ];
    for (const body of bodies) {
      await call('post', '/items', accountantToken, acmeId).send(body).expect(400);
    }
  });

  it('validates item input and edits items', async () => {
    const invalid = [
      { price: 10, incomeAccountId: acmeIncome.id },
      { name: 'TEST Negative', price: -1, incomeAccountId: acmeIncome.id },
      { name: 'TEST Too precise', price: 10.123, incomeAccountId: acmeIncome.id },
      { name: 'TEST No price', incomeAccountId: acmeIncome.id },
      { name: 'TEST Bad field', price: 10, incomeAccountId: acmeIncome.id, balance: 4 },
    ];
    for (const body of invalid) {
      await call('post', '/items', accountantToken, acmeId).send(body).expect(400);
    }

    const res = await call('patch', `/items/${itemId}`, accountantToken, acmeId)
      .send({ name: 'TEST Item Updated', price: 150, taxable: true, active: false })
      .expect(200);
    expect(res.body).toMatchObject({
      name: 'TEST Item Updated',
      price: 150,
      taxable: true,
      active: false,
    });

    const audit = await call('get', '/audit-log?entityType=Item', ownerToken, acmeId).expect(200);
    const actions = (audit.body.entries as AuditRow[]).map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(['item.create', 'item.update']));
  });

  it('keeps items tenant-scoped and guarded by role', async () => {
    await call('get', `/items/${itemId}`, nimbusOwnerToken, nimbusId).expect(404);
    await call('patch', `/items/${itemId}`, nimbusOwnerToken, nimbusId)
      .send({ price: 1 })
      .expect(404);

    const nimbusList = await call('get', '/items?search=TEST Item', nimbusOwnerToken, nimbusId)
      .expect(200);
    expect((nimbusList.body.items as ItemView[]).some((row) => row.id === itemId)).toBe(false);

    await call('post', '/items', viewerToken, acmeId)
      .send({ name: 'TEST Viewer item', price: 5, incomeAccountId: acmeIncome.id })
      .expect(403);
    await call('get', '/items', viewerToken, acmeId).expect(200);
  });
});
