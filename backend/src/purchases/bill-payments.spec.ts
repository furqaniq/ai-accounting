import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.factory';
import { PrismaService } from '../prisma/prisma.service';

interface BillView {
  id: string;
  number: string;
  status: string;
  total: number;
  amountPaid: number;
  balanceDue: number;
  paidAt: string | null;
}

interface BillPaymentView {
  id: string;
  number: string;
  direction: string;
  vendorId: string;
  amount: number;
  method: string;
  applications: Array<{
    id: string;
    billId: string;
    amount: number;
    bill: { id: string; number: string; status: string; balanceDue: number };
  }>;
}

describe('Bill payments', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let staffToken: string;
  let viewerToken: string;
  let nimbusOwnerToken: string;
  let acmeId: string;
  let nimbusId: string;
  let rentAccountId: string;
  let cashAccountId: string;
  let payableAccountId: string;

  const TEST_PREFIX = 'TEST BPAY';

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

  async function createVendor(name: string): Promise<string> {
    const created = await call('post', '/vendors', staffToken, acmeId)
      .send({ name: `${TEST_PREFIX} ${name}`, email: 'bpay@test-vendor.test' })
      .expect(201);
    return created.body.id as string;
  }

  async function createBill(
    vendorId: string,
    amount: number,
    options: { issueDate?: string; dueDate?: string; open?: boolean; notes?: string } = {},
  ): Promise<BillView> {
    const created = await call('post', '/bills', staffToken, acmeId)
      .send({
        vendorId,
        issueDate: options.issueDate ?? '2026-11-01',
        dueDate: options.dueDate ?? '2026-12-01',
        taxRate: 0,
        notes: options.notes ?? `${TEST_PREFIX} bill`,
        lines: [
          {
            description: 'Test expense',
            quantity: 1,
            unitPrice: amount,
            expenseAccountId: rentAccountId,
          },
        ],
      })
      .expect(201);
    if (options.open === false) {
      return created.body as BillView;
    }
    const opened = await call('post', `/bills/${created.body.id}/open`, staffToken, acmeId)
      .expect(201);
    return opened.body as BillView;
  }

  async function createBillPayment(
    vendorId: string,
    amount: number,
    applications: Array<{ billId: string; amount: number }>,
    overrides: Record<string, unknown> = {},
  ): Promise<BillPaymentView> {
    const res = await call('post', '/bill-payments', staffToken, acmeId)
      .send({
        vendorId,
        date: '2026-11-15',
        amount,
        method: 'CHECK',
        reference: `${TEST_PREFIX} reference`,
        notes: `${TEST_PREFIX} payment`,
        applications,
        ...overrides,
      })
      .expect(201);
    return res.body as BillPaymentView;
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
    cashAccountId = rows.find((account) => account.code === '1000')!.id;
    payableAccountId = rows.find((account) => account.code === '2000')!.id;
  });

  beforeEach(async () => {
    await clearTestRows();
  });

  afterAll(async () => {
    await clearTestRows();
    await app.close();
  });

  it('records a partial payment, updates the bill, and posts cash against AP once', async () => {
    const vendorId = await createVendor('Partial Vendor');
    const bill = await createBill(vendorId, 1000);
    const before = await call('get', `/vendors/${vendorId}`, viewerToken, acmeId).expect(200);

    const payment = await createBillPayment(vendorId, 300, [
      { billId: bill.id, amount: 300 },
    ]);

    expect(payment).toMatchObject({
      direction: 'SENT',
      vendorId,
      amount: 300,
      method: 'CHECK',
    });
    expect(payment.number).toMatch(/^BPAY-\d{4}$/);
    expect(payment.applications).toEqual([
      expect.objectContaining({
        billId: bill.id,
        amount: 300,
        bill: expect.objectContaining({ number: bill.number }),
      }),
    ]);

    const detail = await call('get', `/bills/${bill.id}`, viewerToken, acmeId).expect(200);
    expect(detail.body).toMatchObject({
      status: 'PARTIAL',
      amountPaid: 300,
      balanceDue: 700,
      paidAt: null,
    });

    const after = await call('get', `/vendors/${vendorId}`, viewerToken, acmeId).expect(200);
    expect(after.body.balance).toBeCloseTo(before.body.balance - 300, 2);

    const journals = await prisma.journalEntry.findMany({
      where: {
        organizationId: acmeId,
        sourceType: 'PAYMENT',
        sourceId: payment.id,
      },
      include: { lines: true },
    });
    expect(journals).toHaveLength(1);
    expect(journals[0].lines).toHaveLength(2);
    expect(
      journals[0].lines.map((line) => ({
        accountId: line.accountId,
        debit: Number(line.debit),
        credit: Number(line.credit),
      })),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: payableAccountId, debit: 300, credit: 0 }),
        expect.objectContaining({ accountId: cashAccountId, debit: 0, credit: 300 }),
      ]),
    );

    const list = await call(
      'get',
      `/bill-payments?search=${encodeURIComponent(TEST_PREFIX)}`,
      viewerToken,
      acmeId,
    ).expect(200);
    expect(list.body.billPayments).toEqual([
      expect.objectContaining({ id: payment.id, number: payment.number, amount: 300 }),
    ]);
    const byVendor = await call(
      'get',
      `/bill-payments?vendorId=${vendorId}`,
      viewerToken,
      acmeId,
    ).expect(200);
    expect(byVendor.body.billPayments).toHaveLength(1);

    const found = await call('get', `/bill-payments/${payment.id}`, viewerToken, acmeId).expect(
      200,
    );
    expect(found.body).toMatchObject({ id: payment.id, amount: 300 });

    const audit = await call(
      'get',
      '/audit-log?action=bill.pay&limit=100',
      ownerToken,
      acmeId,
    ).expect(200);
    expect(audit.body.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'BillPayment',
          entityId: payment.id,
          action: 'bill.pay',
        }),
      ]),
    );

    await call('post', '/bill-payments', viewerToken, acmeId)
      .send({
        vendorId,
        amount: 1,
        applications: [{ billId: bill.id, amount: 1 }],
      })
      .expect(403);
    await call('get', `/bill-payments/${payment.id}`, nimbusOwnerToken, nimbusId).expect(404);
    const nimbusList = await call('get', '/bill-payments', nimbusOwnerToken, nimbusId).expect(200);
    expect(nimbusList.body.billPayments).not.toContainEqual(
      expect.objectContaining({ id: payment.id }),
    );
  });

  it('applies one payment across bills and moves fully paid bills to Paid', async () => {
    const vendorId = await createVendor('Multi Vendor');
    const first = await createBill(vendorId, 500);
    const second = await createBill(vendorId, 400);

    const payment = await createBillPayment(vendorId, 600, [
      { billId: first.id, amount: 500 },
      { billId: second.id, amount: 100 },
    ]);

    expect(payment.applications).toHaveLength(2);

    const paid = await call('get', `/bills/${first.id}`, viewerToken, acmeId).expect(200);
    expect(paid.body).toMatchObject({
      status: 'PAID',
      amountPaid: 500,
      balanceDue: 0,
    });
    expect(paid.body.paidAt).not.toBeNull();

    const partial = await call('get', `/bills/${second.id}`, viewerToken, acmeId).expect(200);
    expect(partial.body).toMatchObject({
      status: 'PARTIAL',
      amountPaid: 100,
      balanceDue: 300,
      paidAt: null,
    });

    const vendor = await call('get', `/vendors/${vendorId}`, viewerToken, acmeId).expect(200);
    expect(vendor.body.balance).toBe(300);

    const journals = await prisma.journalEntry.findMany({
      where: {
        organizationId: acmeId,
        sourceType: 'PAYMENT',
        sourceId: payment.id,
      },
      include: { lines: true },
    });
    expect(journals).toHaveLength(1);
    const debit = journals[0].lines.reduce((sum, line) => sum + Number(line.debit), 0);
    const credit = journals[0].lines.reduce((sum, line) => sum + Number(line.credit), 0);
    expect(debit).toBe(600);
    expect(credit).toBe(600);
  });

  it('rejects over-application, mismatched receipts, duplicates, closed bills, and foreign bills', async () => {
    const vendorId = await createVendor('Guard Vendor');
    const otherVendorId = await createVendor('Other Vendor');
    const bill = await createBill(vendorId, 1000);
    const draft = await createBill(vendorId, 200, { open: false });
    const settled = await createBill(vendorId, 300);
    const otherBill = await createBill(otherVendorId, 150);
    await createBillPayment(vendorId, 300, [{ billId: settled.id, amount: 300 }]);

    const countBefore = await prisma.billPayment.count({
      where: { organizationId: acmeId, notes: { startsWith: TEST_PREFIX } },
    });

    await call('post', '/bill-payments', staffToken, acmeId)
      .send({
        vendorId,
        date: '2026-11-16',
        amount: 1000.01,
        applications: [{ billId: bill.id, amount: 1000.01 }],
      })
      .expect(400);

    await call('post', '/bill-payments', staffToken, acmeId)
      .send({
        vendorId,
        date: '2026-11-16',
        amount: 100,
        applications: [{ billId: bill.id, amount: 90 }],
      })
      .expect(400);

    await call('post', '/bill-payments', staffToken, acmeId)
      .send({
        vendorId,
        date: '2026-11-16',
        amount: 100,
        applications: [
          { billId: bill.id, amount: 50 },
          { billId: bill.id, amount: 50 },
        ],
      })
      .expect(400);

    await call('post', '/bill-payments', staffToken, acmeId)
      .send({
        vendorId,
        amount: 10,
        applications: [{ billId: draft.id, amount: 10 }],
      })
      .expect(400);

    await call('post', '/bill-payments', staffToken, acmeId)
      .send({
        vendorId,
        amount: 10,
        applications: [{ billId: settled.id, amount: 10 }],
      })
      .expect(400);

    await call('post', '/bill-payments', staffToken, acmeId)
      .send({
        vendorId,
        amount: 10,
        applications: [{ billId: otherBill.id, amount: 10 }],
      })
      .expect(400);

    expect(
      await prisma.billPayment.count({
        where: { organizationId: acmeId, notes: { startsWith: TEST_PREFIX } },
      }),
    ).toBe(countBefore);
    const unchanged = await call('get', `/bills/${bill.id}`, viewerToken, acmeId).expect(200);
    expect(unchanged.body).toMatchObject({ status: 'OPEN', amountPaid: 0 });
    const stillDraft = await call('get', `/bills/${draft.id}`, viewerToken, acmeId).expect(200);
    expect(stillDraft.body.status).toBe('DRAFT');

    await call('post', '/bill-payments', nimbusOwnerToken, nimbusId)
      .send({
        vendorId,
        amount: 10,
        applications: [{ billId: bill.id, amount: 10 }],
      })
      .expect(400);
  });
});
