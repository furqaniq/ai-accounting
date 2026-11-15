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

interface AgingVendor {
  vendorId: string;
  vendorName: string;
  current: number;
  days1To30: number;
  days31To60: number;
  days61To90: number;
  days90Plus: number;
  total: number;
}

interface AgingBill {
  id: string;
  number: string;
  vendorName: string;
  dueDate: string;
  daysOverdue: number;
  bucket: string;
  balanceDue: number;
}

interface ApAgingView {
  asOf: string;
  buckets: AgingBucket[];
  vendors: AgingVendor[];
  bills: AgingBill[];
  overdue: AgingBill[];
  total: number;
}

describe('AP aging report', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let staffToken: string;
  let viewerToken: string;
  let nimbusOwnerToken: string;
  let acmeId: string;
  let nimbusId: string;
  let rentAccountId: string;
  let agingVendorId: string;

  const TEST_PREFIX = 'TEST AP AGING';

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'Passw0rd!2026' })
      .expect(200);
    return res.body.accessToken;
  }

  function call(
    method: 'get' | 'post',
    path: string,
    token: string,
    orgId: string,
  ) {
    return request(app.getHttpServer())[method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', orgId);
  }

  async function clearTestRows(): Promise<void> {
    const payments = await prisma.billPayment.findMany({
      where: { organizationId: acmeId, notes: { startsWith: TEST_PREFIX } },
      select: { id: true },
    });
    if (payments.length > 0) {
      await prisma.journalEntry.deleteMany({
        where: { sourceType: 'PAYMENT', sourceId: { in: payments.map((row) => row.id) } },
      });
      await prisma.billPayment.deleteMany({
        where: { id: { in: payments.map((row) => row.id) } },
      });
    }
    const bills = await prisma.bill.findMany({
      where: { organizationId: acmeId, notes: { startsWith: TEST_PREFIX } },
      select: { id: true },
    });
    if (bills.length > 0) {
      await prisma.journalEntry.deleteMany({
        where: { sourceType: 'BILL', sourceId: { in: bills.map((row) => row.id) } },
      });
      await prisma.bill.deleteMany({ where: { id: { in: bills.map((row) => row.id) } } });
    }
    await prisma.vendor.deleteMany({
      where: { organizationId: acmeId, name: { startsWith: TEST_PREFIX } },
    });
  }

  async function createVendor(): Promise<string> {
    const created = await call('post', '/vendors', staffToken, acmeId)
      .send({ name: `${TEST_PREFIX} Vendor`, email: 'aging@test-vendor.test' })
      .expect(201);
    return created.body.id as string;
  }

  async function createBill(
    amount: number,
    issueDate: string,
    dueDate: string,
    options: { open?: boolean; notes?: string } = {},
  ): Promise<{ id: string; number: string; total: number }> {
    const created = await call('post', '/bills', staffToken, acmeId)
      .send({
        vendorId: agingVendorId,
        issueDate,
        dueDate,
        taxRate: 0,
        notes: options.notes ?? `${TEST_PREFIX} bill`,
        lines: [
          {
            description: 'Aging expense',
            quantity: 1,
            unitPrice: amount,
            expenseAccountId: rentAccountId,
          },
        ],
      })
      .expect(201);
    if (options.open !== false) {
      await call('post', `/bills/${created.body.id}/open`, staffToken, acmeId).expect(201);
    }
    return created.body;
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
    rentAccountId = (
      accounts.body.accounts as Array<{ id: string; code: string }>
    ).find((account) => account.code === '6000')!.id;
  });

  beforeEach(async () => {
    await clearTestRows();
    agingVendorId = await createVendor();
  });

  afterAll(async () => {
    await clearTestRows();
    await app.close();
  });

  it('reports seeded open payables in standard buckets for a read-only viewer', async () => {
    const res = await call(
      'get',
      '/reports/ap-aging?asOf=2026-11-14',
      viewerToken,
      acmeId,
    ).expect(200);
    const report = res.body as ApAgingView;

    expect(report.asOf).toBe('2026-11-14');
    expect(report.buckets.map((bucket) => bucket.label)).toEqual([
      'Current',
      '1–30',
      '31–60',
      '61–90',
      '90+',
    ]);
    expect(report.total).toBe(1124.5);

    expect(
      report.vendors.find((vendor) => vendor.vendorName === 'Halden Paper'),
    ).toMatchObject({ current: 649.5, total: 649.5 });
    expect(
      report.vendors.find((vendor) => vendor.vendorName === 'Brightline Utilities'),
    ).toMatchObject({ days1To30: 475, total: 475 });
    expect(report.bills.map((bill) => bill.number).sort()).toEqual([
      'BILL-1001',
      'BILL-1002',
    ]);
    expect(report.overdue).toEqual([
      expect.objectContaining({
        number: 'BILL-1002',
        vendorName: 'Brightline Utilities',
        dueDate: '2026-10-15',
        daysOverdue: 30,
        bucket: '1-30',
        balanceDue: 475,
      }),
    ]);
  });

  it('places balances in the right bucket at each boundary and omits drafts', async () => {
    await createBill(101, '2026-01-01', '2026-06-30');
    await createBill(102, '2026-01-01', '2026-06-29');
    await createBill(103, '2026-01-01', '2026-05-31');
    await createBill(104, '2026-01-01', '2026-05-30');
    await createBill(105, '2026-01-01', '2026-05-01');
    await createBill(106, '2026-01-01', '2026-04-30');
    await createBill(107, '2026-01-01', '2026-04-01');
    await createBill(108, '2026-01-01', '2026-03-31');
    const draft = await createBill(999, '2026-01-01', '2026-05-01', {
      open: false,
      notes: `${TEST_PREFIX} draft bill`,
    });

    const res = await call(
      'get',
      '/reports/ap-aging?asOf=2026-06-30',
      ownerToken,
      acmeId,
    ).expect(200);
    const report = res.body as ApAgingView;
    const vendor = report.vendors.find((row) => row.vendorId === agingVendorId);

    expect(vendor).toMatchObject({
      vendorName: `${TEST_PREFIX} Vendor`,
      current: 101,
      days1To30: 205,
      days31To60: 209,
      days61To90: 213,
      days90Plus: 108,
      total: 836,
    });
    expect(report.bills.some((bill) => bill.id === draft.id)).toBe(false);
    expect(report.bills).not.toContainEqual(
      expect.objectContaining({ vendorId: agingVendorId, balanceDue: 999 }),
    );
  });

  it('ages balances as of the selected date and ignores later payments', async () => {
    const bill = await createBill(500, '2026-01-01', '2026-06-01', {
      notes: `${TEST_PREFIX} partial bill`,
    });
    await call('post', '/bill-payments', staffToken, acmeId)
      .send({
        vendorId: agingVendorId,
        date: '2026-06-15',
        amount: 200,
        notes: `${TEST_PREFIX} partial payment`,
        applications: [{ billId: bill.id, amount: 200 }],
      })
      .expect(201);

    const beforePayment = await call(
      'get',
      '/reports/ap-aging?asOf=2026-06-14',
      viewerToken,
      acmeId,
    ).expect(200);
    const before = (beforePayment.body as ApAgingView).bills.find(
      (row) => row.id === bill.id,
    );
    expect(before).toMatchObject({ balanceDue: 500, bucket: '1-30', daysOverdue: 13 });

    const onPayment = await call(
      'get',
      '/reports/ap-aging?asOf=2026-06-15',
      viewerToken,
      acmeId,
    ).expect(200);
    const after = (onPayment.body as ApAgingView).bills.find((row) => row.id === bill.id);
    expect(after).toMatchObject({ balanceDue: 300, bucket: '1-30', daysOverdue: 14 });

    await call('post', '/bill-payments', staffToken, acmeId)
      .send({
        vendorId: agingVendorId,
        date: '2026-07-01',
        amount: 300,
        notes: `${TEST_PREFIX} final payment`,
        applications: [{ billId: bill.id, amount: 300 }],
      })
      .expect(201);

    const stillOpen = await call(
      'get',
      '/reports/ap-aging?asOf=2026-06-30',
      viewerToken,
      acmeId,
    ).expect(200);
    expect(
      (stillOpen.body as ApAgingView).bills.find((row) => row.id === bill.id),
    ).toMatchObject({ balanceDue: 300 });

    const settled = await call(
      'get',
      '/reports/ap-aging?asOf=2026-07-01',
      viewerToken,
      acmeId,
    ).expect(200);
    expect((settled.body as ApAgingView).bills.some((row) => row.id === bill.id)).toBe(false);
  });

  it('keeps organizations isolated and guards the report by role', async () => {
    const nimbus = await call(
      'get',
      '/reports/ap-aging?asOf=2026-11-14',
      nimbusOwnerToken,
      nimbusId,
    ).expect(200);
    const report = nimbus.body as ApAgingView;

    expect(report.total).toBe(324.75);
    expect(report.vendors.map((vendor) => vendor.vendorName)).toEqual(['Ridge Supply Co.']);
    expect(report.vendors).not.toContainEqual(
      expect.objectContaining({ vendorName: 'Halden Paper' }),
    );

    await call('get', '/reports/ap-aging?asOf=2026-11-14', nimbusOwnerToken, acmeId).expect(403);
  });
});
