import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.factory';
import { PrismaService } from '../prisma/prisma.service';

interface AgingBucket {
  key: string;
  label: string;
  amount: number;
  count: number;
}

interface AgingCustomer {
  customerId: string;
  customerName: string;
  current: number;
  days1To30: number;
  days31To60: number;
  days61To90: number;
  days90Plus: number;
  total: number;
}

interface AgingInvoice {
  id: string;
  number: string;
  customerName: string;
  dueDate: string;
  daysOverdue: number;
  bucket: string;
  balanceDue: number;
}

interface ArAgingView {
  asOf: string;
  buckets: AgingBucket[];
  customers: AgingCustomer[];
  invoices: AgingInvoice[];
  overdue: AgingInvoice[];
  total: number;
}

describe('AR aging report', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let viewerToken: string;
  let nimbusOwnerToken: string;
  let acmeId: string;
  let nimbusId: string;
  let itemId: string;
  let agingCustomerId: string;

  const TEST_PREFIX = 'TEST AGING';

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'Passw0rd!2026' })
      .expect(200);
    return res.body.accessToken;
  }

  function call(path: string, token: string, orgId: string) {
    return request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', orgId);
  }

  async function clearTestRows(): Promise<void> {
    const payments = await prisma.payment.findMany({
      where: { organizationId: acmeId, notes: { startsWith: TEST_PREFIX } },
      select: { id: true },
    });
    if (payments.length > 0) {
      await prisma.journalEntry.deleteMany({
        where: { sourceType: 'PAYMENT', sourceId: { in: payments.map((row) => row.id) } },
      });
      await prisma.payment.deleteMany({ where: { id: { in: payments.map((row) => row.id) } } });
    }
    const invoices = await prisma.invoice.findMany({
      where: { organizationId: acmeId, notes: { startsWith: TEST_PREFIX } },
      select: { id: true },
    });
    if (invoices.length > 0) {
      await prisma.journalEntry.deleteMany({
        where: { sourceType: 'INVOICE', sourceId: { in: invoices.map((row) => row.id) } },
      });
      await prisma.invoice.deleteMany({ where: { id: { in: invoices.map((row) => row.id) } } });
    }
    await prisma.customer.deleteMany({
      where: { organizationId: acmeId, name: { startsWith: TEST_PREFIX } },
    });
  }

  async function createAgingInvoice(
    customerId: string,
    amount: number,
    issueDate: string,
    dueDate: string,
    options: { notes?: string; send?: boolean } = {},
  ): Promise<{ id: string; number: string; total: number }> {
    const created = await request(app.getHttpServer())
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Organization-Id', acmeId)
      .send({
        customerId,
        issueDate,
        dueDate,
        taxRate: 0,
        notes: options.notes ?? `${TEST_PREFIX} invoice`,
        lines: [{ itemId, quantity: 1, unitPrice: amount }],
      })
      .expect(201);
    if (options.send !== false) {
      await request(app.getHttpServer())
        .post(`/api/v1/invoices/${created.body.id}/send`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Organization-Id', acmeId)
        .expect(201);
    }
    return created.body;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    prisma = moduleRef.get(PrismaService);

    [ownerToken, viewerToken, nimbusOwnerToken] = await Promise.all([
      login('owner@acme.test'),
      login('viewer@acme.test'),
      login('owner@nimbus.test'),
    ]);

    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    acmeId = me.body.memberships.find(
      (m: { organizationName: string }) => m.organizationName === 'Acme Services Co.',
    ).organizationId;
    nimbusId = me.body.memberships.find(
      (m: { organizationName: string }) => m.organizationName === 'Nimbus Retail LLC',
    ).organizationId;

    await clearTestRows();
    const items = await request(app.getHttpServer())
      .get('/api/v1/items')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Organization-Id', acmeId)
      .expect(200);
    itemId = items.body.items.find(
      (item: { name: string }) => item.name === 'Consulting hour',
    ).id;
  });

  beforeEach(async () => {
    await clearTestRows();
    const customer = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Organization-Id', acmeId)
      .send({ name: `${TEST_PREFIX} Customer`, email: 'aging@example.test' })
      .expect(201);
    agingCustomerId = customer.body.id;
  });

  afterAll(async () => {
    await clearTestRows();
    await app.close();
  });

  it('reports seeded open receivables in standard buckets for a read-only viewer', async () => {
    const res = await call('/reports/ar-aging?asOf=2026-11-14', viewerToken, acmeId).expect(200);
    const report = res.body as ArAgingView;

    expect(report.asOf).toBe('2026-11-14');
    expect(report.buckets.map((bucket) => bucket.label)).toEqual([
      'Current',
      '1–30',
      '31–60',
      '61–90',
      '90+',
    ]);
    expect(report.total).toBe(1274.25);

    const northwind = report.customers.find(
      (customer) => customer.customerName === 'Northwind Studio',
    );
    expect(northwind).toMatchObject({ current: 300, total: 300 });

    const harbor = report.customers.find((customer) => customer.customerName === 'Harbor & Pine');
    expect(harbor).toMatchObject({ days1To30: 974.25, total: 974.25 });

    expect(report.invoices.map((invoice) => invoice.number).sort()).toEqual([
      'INV-1001',
      'INV-1002',
    ]);
    expect(report.overdue).toEqual([
      expect.objectContaining({
        number: 'INV-1002',
        customerName: 'Harbor & Pine',
        dueDate: '2026-10-15',
        daysOverdue: 30,
        bucket: '1-30',
        balanceDue: 974.25,
      }),
    ]);
  });

  it('places balances in the right bucket at each boundary and omits drafts', async () => {
    await createAgingInvoice(agingCustomerId, 101, '2026-01-01', '2026-06-30');
    await createAgingInvoice(agingCustomerId, 102, '2026-01-01', '2026-06-29');
    await createAgingInvoice(agingCustomerId, 103, '2026-01-01', '2026-05-31');
    await createAgingInvoice(agingCustomerId, 104, '2026-01-01', '2026-05-30');
    await createAgingInvoice(agingCustomerId, 105, '2026-01-01', '2026-05-01');
    await createAgingInvoice(agingCustomerId, 106, '2026-01-01', '2026-04-30');
    await createAgingInvoice(agingCustomerId, 107, '2026-01-01', '2026-04-01');
    await createAgingInvoice(agingCustomerId, 108, '2026-01-01', '2026-03-31');
    const draft = await createAgingInvoice(agingCustomerId, 999, '2026-01-01', '2026-05-01', {
      notes: `${TEST_PREFIX} draft`,
      send: false,
    });

    const res = await call('/reports/ar-aging?asOf=2026-06-30', ownerToken, acmeId).expect(200);
    const report = res.body as ArAgingView;
    const customer = report.customers.find((row) => row.customerId === agingCustomerId);

    expect(customer).toMatchObject({
      customerName: `${TEST_PREFIX} Customer`,
      current: 101,
      days1To30: 205,
      days31To60: 209,
      days61To90: 213,
      days90Plus: 108,
      total: 836,
    });
    expect(report.invoices.some((invoice) => invoice.id === draft.id)).toBe(false);
    expect(report.invoices).not.toContainEqual(
      expect.objectContaining({ customerId: agingCustomerId, balanceDue: 999 }),
    );
  });

  it('ages balances as of the selected date and ignores later payments', async () => {
    const partial = await createAgingInvoice(
      agingCustomerId,
      500,
      '2026-01-01',
      '2026-06-01',
      { notes: `${TEST_PREFIX} partial invoice` },
    );
    const fullyPaidLater = await createAgingInvoice(
      agingCustomerId,
      175,
      '2026-01-01',
      '2026-05-01',
      { notes: `${TEST_PREFIX} later paid invoice` },
    );

    await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Organization-Id', acmeId)
      .send({
        customerId: agingCustomerId,
        date: '2026-06-10',
        amount: 200,
        notes: `${TEST_PREFIX} partial receipt`,
        applications: [{ invoiceId: partial.id, amount: 200 }],
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Organization-Id', acmeId)
      .send({
        customerId: agingCustomerId,
        date: '2026-06-20',
        amount: 175,
        notes: `${TEST_PREFIX} final receipt`,
        applications: [{ invoiceId: fullyPaidLater.id, amount: 175 }],
      })
      .expect(201);

    const before = (await call('/reports/ar-aging?asOf=2026-06-09', ownerToken, acmeId).expect(200))
      .body as ArAgingView;
    const partialBefore = before.invoices.find((invoice) => invoice.id === partial.id);
    expect(partialBefore).toMatchObject({
      daysOverdue: 8,
      bucket: '1-30',
      balanceDue: 500,
    });
    expect(before.invoices).toContainEqual(
      expect.objectContaining({ id: fullyPaidLater.id, balanceDue: 175 }),
    );

    const afterPartial = (await call('/reports/ar-aging?asOf=2026-06-15', ownerToken, acmeId).expect(
      200,
    )).body as ArAgingView;
    expect(afterPartial.invoices.find((invoice) => invoice.id === partial.id)).toMatchObject({
      daysOverdue: 14,
      bucket: '1-30',
      balanceDue: 300,
    });
    expect(afterPartial.invoices).toContainEqual(
      expect.objectContaining({ id: fullyPaidLater.id, balanceDue: 175 }),
    );

    const afterAll = (await call('/reports/ar-aging?asOf=2026-06-30', ownerToken, acmeId).expect(200))
      .body as ArAgingView;
    expect(afterAll.invoices).toContainEqual(
      expect.objectContaining({ id: partial.id, balanceDue: 300 }),
    );
    expect(afterAll.invoices.some((invoice) => invoice.id === fullyPaidLater.id)).toBe(false);
    expect(afterAll.customers.find((row) => row.customerId === agingCustomerId)?.total).toBe(300);

    const openInvoices = (
      await request(app.getHttpServer())
        .get(`/api/v1/invoices?customerId=${agingCustomerId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Organization-Id', acmeId)
        .expect(200)
    ).body.invoices as Array<{ status: string; balanceDue: number }>;
    const ledgerOpenTotal = openInvoices
      .filter((invoice) => invoice.status !== 'DRAFT')
      .reduce((sum, invoice) => sum + invoice.balanceDue, 0);
    expect(afterAll.customers.find((row) => row.customerId === agingCustomerId)?.total).toBe(
      ledgerOpenTotal,
    );
  });

  it('keeps each organization’s receivables isolated', async () => {
    const acme = (await call('/reports/ar-aging?asOf=2026-11-14', ownerToken, acmeId).expect(200))
      .body as ArAgingView;
    const nimbus = (
      await call('/reports/ar-aging?asOf=2026-11-14', nimbusOwnerToken, nimbusId).expect(200)
    ).body as ArAgingView;

    expect(acme.customers.map((customer) => customer.customerName)).toEqual(
      expect.arrayContaining(['Northwind Studio', 'Harbor & Pine']),
    );
    expect(acme.customers.some((customer) => customer.customerName === 'Cedar Market')).toBe(false);

    expect(nimbus.customers.map((customer) => customer.customerName)).toEqual(['Cedar Market']);
    expect(nimbus.total).toBe(259.8);
    expect(nimbus.customers.some((customer) => customer.customerName === 'Northwind Studio')).toBe(
      false,
    );
  });
});
