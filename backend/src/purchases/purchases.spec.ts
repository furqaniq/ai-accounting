import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.factory';
import { PrismaService } from '../prisma/prisma.service';

interface VendorView {
  id: string;
  code: string;
  name: string;
  contactName: string | null;
  email: string | null;
  active: boolean;
  balance: number;
}

describe('Vendors and bills', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let staffToken: string;
  let viewerToken: string;
  let nimbusOwnerToken: string;
  let acmeId: string;
  let nimbusId: string;
  let rentAccountId: string;
  let suppliesAccountId: string;
  let payableAccountId: string;
  let purchaseTaxAccountId: string;

  const TEST_PREFIX = 'TEST PUR';

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
    const vendors = await prisma.vendor.findMany({
      where: { organizationId: acmeId, name: { startsWith: TEST_PREFIX } },
      select: { id: true },
    });
    if (vendors.length > 0) {
      const vendorIds = vendors.map((vendor) => vendor.id);
      const bills = await prisma.bill.findMany({
        where: { organizationId: acmeId, vendorId: { in: vendorIds } },
        select: { id: true },
      });
      if (bills.length > 0) {
        await prisma.journalEntry.deleteMany({
          where: { sourceType: 'BILL', sourceId: { in: bills.map((bill) => bill.id) } },
        });
        await prisma.bill.deleteMany({ where: { id: { in: bills.map((bill) => bill.id) } } });
      }
      await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
    }
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

    const accounts = await call('get', '/accounts', ownerToken, acmeId).expect(200);
    const rows = accounts.body.accounts as Array<{ id: string; code: string }>;
    rentAccountId = rows.find((account) => account.code === '6000')!.id;
    suppliesAccountId = rows.find((account) => account.code === '6200')!.id;
    payableAccountId = rows.find((account) => account.code === '2000')!.id;
    purchaseTaxAccountId = rows.find((account) => account.code === '1300')!.id;
  });

  beforeEach(async () => {
    await clearTestRows();
  });

  afterAll(async () => {
    await clearTestRows();
    await app.close();
  });

  it('creates, searches, updates, and reads a vendor with a derived balance', async () => {
    const created = await call('post', '/vendors', staffToken, acmeId)
      .send({
        name: `${TEST_PREFIX} Supply`,
        contactName: 'Pat Vendor',
        email: 'pay@test-vendor.test',
        phone: '555-0101',
        city: 'Denver',
        region: 'CO',
      })
      .expect(201);
    const vendor = created.body as VendorView;
    expect(vendor.code).toMatch(/^VEND-\d{4}$/);
    expect(vendor).toMatchObject({
      name: `${TEST_PREFIX} Supply`,
      contactName: 'Pat Vendor',
      email: 'pay@test-vendor.test',
      active: true,
      balance: 0,
    });

    const list = await call('get', '/vendors?search=TEST%20PUR', viewerToken, acmeId).expect(200);
    expect(list.body.vendors).toEqual([
      expect.objectContaining({ id: vendor.id, name: `${TEST_PREFIX} Supply`, balance: 0 }),
    ]);

    const updated = await call('patch', `/vendors/${vendor.id}`, staffToken, acmeId)
      .send({ contactName: 'Dana Vendor', notes: 'Net 30 terms' })
      .expect(200);
    expect(updated.body).toMatchObject({
      contactName: 'Dana Vendor',
      notes: 'Net 30 terms',
      balance: 0,
    });

    const detail = await call('get', `/vendors/${vendor.id}`, viewerToken, acmeId).expect(200);
    expect(detail.body).toMatchObject({ id: vendor.id, name: `${TEST_PREFIX} Supply` });

    const audit = await call('get', '/audit-log?action=vendor.update&limit=100', ownerToken, acmeId)
      .expect(200);
    expect(audit.body.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityType: 'Vendor', entityId: vendor.id }),
      ]),
    );

    await call('post', '/vendors', viewerToken, acmeId)
      .send({ name: `${TEST_PREFIX} Forbidden` })
      .expect(403);

    await call('get', `/vendors/${vendor.id}`, nimbusOwnerToken, nimbusId).expect(404);
    const nimbusList = await call('get', '/vendors?search=TEST%20PUR', nimbusOwnerToken, nimbusId)
      .expect(200);
    expect(nimbusList.body.vendors).toEqual([]);
  });

  it('opens a draft bill once, posts balanced expenses and AP, and guards reads', async () => {
    const vendorRes = await call('post', '/vendors', staffToken, acmeId)
      .send({ name: `${TEST_PREFIX} Bill Vendor`, email: 'bills@test-vendor.test' })
      .expect(201);
    const vendorId = vendorRes.body.id as string;

    const created = await call('post', '/bills', staffToken, acmeId)
      .send({
        vendorId,
        issueDate: '2026-11-01',
        dueDate: '2026-12-01',
        taxRate: 0.1,
        notes: `${TEST_PREFIX} bill`,
        lines: [
          {
            description: 'Monthly rent',
            quantity: 1,
            unitPrice: 1000,
            expenseAccountId: rentAccountId,
          },
          {
            description: 'Office supplies',
            quantity: 2,
            unitPrice: 50,
            expenseAccountId: suppliesAccountId,
          },
        ],
      })
      .expect(201);
    const bill = created.body as {
      id: string;
      number: string;
      status: string;
      subtotal: number;
      taxTotal: number;
      total: number;
      amountPaid: number;
      dueDate: string;
      openedAt: string | null;
      vendor: { id: string; name: string };
      lines: Array<{ description: string; amount: number; expenseAccount: { code: string } }>;
    };

    expect(bill.number).toMatch(/^BILL-\d{4}$/);
    expect(bill).toMatchObject({
      status: 'DRAFT',
      subtotal: 1100,
      taxTotal: 110,
      total: 1210,
      amountPaid: 0,
      dueDate: '2026-12-01',
      openedAt: null,
      vendor: { id: vendorId, name: `${TEST_PREFIX} Bill Vendor` },
    });
    expect(bill.lines).toHaveLength(2);
    expect(await prisma.journalEntry.count({ where: { sourceType: 'BILL', sourceId: bill.id } })).toBe(
      0,
    );

    const opened = await call('post', `/bills/${bill.id}/open`, staffToken, acmeId).expect(201);
    expect(opened.body).toMatchObject({ status: 'OPEN', total: 1210, amountPaid: 0 });
    expect(opened.body.openedAt).not.toBeNull();

    const journals = await prisma.journalEntry.findMany({
      where: { organizationId: acmeId, sourceType: 'BILL', sourceId: bill.id },
      include: { lines: true },
    });
    expect(journals).toHaveLength(1);
    expect(journals[0].lines).toHaveLength(4);
    const journalLines = journals[0].lines.map((line) => ({
      accountId: line.accountId,
      debit: Number(line.debit),
      credit: Number(line.credit),
    }));
    expect(journalLines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: rentAccountId, debit: 1000, credit: 0 }),
        expect.objectContaining({ accountId: suppliesAccountId, debit: 100, credit: 0 }),
        expect.objectContaining({ accountId: purchaseTaxAccountId, debit: 110, credit: 0 }),
        expect.objectContaining({ accountId: payableAccountId, debit: 0, credit: 1210 }),
      ]),
    );

    const vendor = await call('get', `/vendors/${vendorId}`, viewerToken, acmeId).expect(200);
    expect(vendor.body.balance).toBe(1210);

    const reopened = await call('post', `/bills/${bill.id}/open`, staffToken, acmeId).expect(201);
    expect(reopened.body.status).toBe('OPEN');
    expect(await prisma.journalEntry.count({ where: { sourceType: 'BILL', sourceId: bill.id } })).toBe(
      1,
    );

    const list = await call('get', `/bills?vendorId=${vendorId}`, viewerToken, acmeId).expect(200);
    expect(list.body.bills).toEqual([
      expect.objectContaining({ id: bill.id, number: bill.number, status: 'OPEN', total: 1210 }),
    ]);
    const detail = await call('get', `/bills/${bill.id}`, viewerToken, acmeId).expect(200);
    expect(detail.body).toMatchObject({ id: bill.id, notes: `${TEST_PREFIX} bill` });

    const audit = await call('get', '/audit-log?action=bill.open&limit=100', ownerToken, acmeId)
      .expect(200);
    expect(audit.body.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityType: 'Bill', entityId: bill.id, action: 'bill.open' }),
      ]),
    );

    await call('get', `/bills/${bill.id}`, nimbusOwnerToken, nimbusId).expect(404);
    const nimbusList = await call('get', '/bills', nimbusOwnerToken, nimbusId).expect(200);
    expect(nimbusList.body.bills).not.toContainEqual(
      expect.objectContaining({ id: bill.id }),
    );
    await call('post', '/bills', viewerToken, acmeId)
      .send({
        vendorId,
        issueDate: '2026-11-01',
        dueDate: '2026-12-01',
        lines: [
          {
            description: 'Forbidden',
            quantity: 1,
            unitPrice: 1,
            expenseAccountId: rentAccountId,
          },
        ],
      })
      .expect(403);
  });

  it('edits only draft bills, validates expense accounts and dates, and audits changes', async () => {
    const vendor = await call('post', '/vendors', staffToken, acmeId)
      .send({ name: `${TEST_PREFIX} Draft Vendor` })
      .expect(201);
    const revenueAccount = (
      await call('get', '/accounts', ownerToken, acmeId).expect(200)
    ).body.accounts.find((account: { code: string }) => account.code === '4000');

    const created = await call('post', '/bills', staffToken, acmeId)
      .send({
        vendorId: vendor.body.id,
        issueDate: '2026-11-01',
        dueDate: '2026-12-01',
        taxRate: 0,
        notes: `${TEST_PREFIX} draft bill`,
        lines: [
          {
            description: 'Monthly rent',
            quantity: 1,
            unitPrice: 100,
            expenseAccountId: rentAccountId,
          },
        ],
      })
      .expect(201);

    const updated = await call('patch', `/bills/${created.body.id}`, staffToken, acmeId)
      .send({
        dueDate: '2026-12-15',
        taxRate: 0.05,
        notes: `${TEST_PREFIX} revised bill`,
        lines: [
          {
            description: 'Monthly rent',
            quantity: 2,
            unitPrice: 100,
            expenseAccountId: rentAccountId,
          },
          {
            description: 'Supplies',
            quantity: 1,
            unitPrice: 25,
            expenseAccountId: suppliesAccountId,
          },
        ],
      })
      .expect(200);
    expect(updated.body).toMatchObject({
      status: 'DRAFT',
      dueDate: '2026-12-15',
      subtotal: 225,
      taxTotal: 11.25,
      total: 236.25,
      notes: `${TEST_PREFIX} revised bill`,
    });
    expect(updated.body.lines).toHaveLength(2);

    const audit = await call('get', '/audit-log?action=bill.update&limit=100', ownerToken, acmeId)
      .expect(200);
    expect(audit.body.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityType: 'Bill', entityId: created.body.id }),
      ]),
    );

    await call('post', `/bills/${created.body.id}/open`, staffToken, acmeId).expect(201);
    await call('patch', `/bills/${created.body.id}`, staffToken, acmeId)
      .send({ notes: 'Too late to edit' })
      .expect(400);

    await call('post', '/bills', staffToken, acmeId)
      .send({
        vendorId: vendor.body.id,
        issueDate: '2026-11-01',
        dueDate: '2026-12-01',
        lines: [
          {
            description: 'Wrong account type',
            quantity: 1,
            unitPrice: 10,
            expenseAccountId: revenueAccount.id,
          },
        ],
      })
      .expect(400);

    await call('post', '/bills', staffToken, acmeId)
      .send({
        vendorId: vendor.body.id,
        issueDate: '2026-12-01',
        dueDate: '2026-11-01',
        lines: [
          {
            description: 'Bad dates',
            quantity: 1,
            unitPrice: 10,
            expenseAccountId: rentAccountId,
          },
        ],
      })
      .expect(400);
  });
});
