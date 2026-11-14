import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.factory';
import { PrismaService } from '../prisma/prisma.service';

interface InvoiceView {
  id: string;
  number: string;
  status: string;
  amountPaid: number;
  balanceDue: number;
  total: number;
  paidAt: string | null;
}

interface PaymentView {
  id: string;
  number: string;
  direction: string;
  customerId: string;
  amount: number;
  method: string;
  applications: Array<{
    id: string;
    invoiceId: string;
    amount: number;
  }>;
}

interface JournalEntryView {
  id: string;
  sourceType: string;
  sourceId: string | null;
  lines: Array<{ accountId: string; debit: number; credit: number }>;
}

describe('Customer payments', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let staffToken: string;
  let viewerToken: string;
  let nimbusOwnerToken: string;
  let acmeId: string;
  let nimbusId: string;
  let customerId: string;
  let nimbusCustomerId: string;
  let hourlyItemId: string;
  let packageItemId: string;
  let cashAccountId: string;
  let arAccountId: string;

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

  async function clearTestRows(): Promise<void> {
    const payments = await prisma.payment.findMany({
      where: { notes: { startsWith: 'TEST PAY' } },
      select: { id: true },
    });
    if (payments.length > 0) {
      await prisma.journalEntry.deleteMany({
        where: { sourceType: 'PAYMENT', sourceId: { in: payments.map((row) => row.id) } },
      });
      await prisma.payment.deleteMany({ where: { id: { in: payments.map((row) => row.id) } } });
    }
    await prisma.invoice.deleteMany({ where: { notes: { startsWith: 'TEST PAY' } } });
  }

  async function createSentInvoice(notes: string): Promise<InvoiceView> {
    const created = await call('post', '/invoices', staffToken, acmeId)
      .send({
        customerId,
        issueDate: '2026-11-01',
        dueDate: '2026-12-01',
        taxRate: 0.0825,
        notes,
        lines: [
          { itemId: hourlyItemId, quantity: 2, unitPrice: 150 },
          { itemId: packageItemId, quantity: 1, unitPrice: 900 },
        ],
      })
      .expect(201);
    await call('post', `/invoices/${created.body.id}/send`, staffToken, acmeId).expect(201);
    return created.body as InvoiceView;
  }

  async function createPayment(
    invoiceId: string,
    amount: number,
    overrides: Record<string, unknown> = {},
  ): Promise<PaymentView> {
    const res = await call('post', '/payments', staffToken, acmeId)
      .send({
        customerId,
        date: '2026-11-15',
        amount,
        method: 'BANK_TRANSFER',
        reference: 'TEST PAY reference',
        notes: 'TEST PAY receipt',
        applications: [{ invoiceId, amount }],
        ...overrides,
      })
      .expect(201);
    return res.body as PaymentView;
  }

  async function journalEntriesFor(paymentId: string): Promise<JournalEntryView[]> {
    const res = await call('get', '/journal-entries?limit=200', ownerToken, acmeId).expect(200);
    return (res.body.entries as JournalEntryView[]).filter(
      (entry) => entry.sourceType === 'PAYMENT' && entry.sourceId === paymentId,
    );
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    prisma = moduleRef.get(PrismaService);
    await clearTestRows();

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

    const customers = await call('get', '/customers', ownerToken, acmeId).expect(200);
    customerId = (customers.body.customers as Array<{ id: string; name: string }>).find(
      (customer) => customer.name === 'Northwind Studio',
    )!.id;
    const nimbusCustomers = await call('get', '/customers', nimbusOwnerToken, nimbusId).expect(200);
    nimbusCustomerId = (nimbusCustomers.body.customers as Array<{ id: string; name: string }>).find(
      (customer) => customer.name === 'Cedar Market',
    )!.id;

    const items = await call('get', '/items', ownerToken, acmeId).expect(200);
    hourlyItemId = (items.body.items as Array<{ id: string; name: string }>).find(
      (item) => item.name === 'Consulting hour',
    )!.id;
    packageItemId = (items.body.items as Array<{ id: string; name: string }>).find(
      (item) => item.name === 'Design package',
    )!.id;

    const accounts = await call('get', '/accounts', ownerToken, acmeId).expect(200);
    const rows = accounts.body.accounts as Array<{ id: string; code: string }>;
    cashAccountId = rows.find((account) => account.code === '1000')!.id;
    arAccountId = rows.find((account) => account.code === '1100')!.id;
  });

  afterAll(async () => {
    await clearTestRows();
    await app.close();
  });

  it('records a partial payment, updates the invoice, and posts cash against AR once', async () => {
    const invoice = await createSentInvoice('TEST PAY partial invoice');
    const before = await call('get', `/customers/${customerId}`, ownerToken, acmeId).expect(200);
    const payment = await createPayment(invoice.id, 300);

    expect(payment).toMatchObject({
      direction: 'RECEIVED',
      customerId,
      amount: 300,
      method: 'BANK_TRANSFER',
    });
    expect(payment.number).toMatch(/^PAY-\d{4}$/);
    expect(payment.applications).toHaveLength(1);
    expect(payment.applications[0]).toMatchObject({ invoiceId: invoice.id, amount: 300 });

    const detail = await call('get', `/invoices/${invoice.id}`, viewerToken, acmeId).expect(200);
    expect(detail.body).toMatchObject({
      status: 'PARTIAL',
      amountPaid: 300,
      balanceDue: 974.25,
      paidAt: null,
    });

    const after = await call('get', `/customers/${customerId}`, ownerToken, acmeId).expect(200);
    expect(after.body.balance).toBeCloseTo(before.body.balance - 300, 2);

    const journals = await journalEntriesFor(payment.id);
    expect(journals).toHaveLength(1);
    expect(journals[0].lines).toHaveLength(2);
    expect(journals[0].lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: cashAccountId, debit: 300, credit: 0 }),
        expect.objectContaining({ accountId: arAccountId, debit: 0, credit: 300 }),
      ]),
    );
  });
  it('applies one payment across invoices and moves fully paid invoices to Paid', async () => {
    const first = await createSentInvoice('TEST PAY full invoice A');
    const second = await createSentInvoice('TEST PAY partial invoice B');
    const amount = first.total + 400;
    const payment = await createPayment(first.id, amount, {
      applications: [
        { invoiceId: first.id, amount: first.total },
        { invoiceId: second.id, amount: 400 },
      ],
    });

    expect(payment.applications).toHaveLength(2);
    expect(payment.applications.map((application) => application.amount)).toEqual(
      expect.arrayContaining([400, first.total]),
    );

    const paid = await call('get', `/invoices/${first.id}`, viewerToken, acmeId).expect(200);
    expect(paid.body).toMatchObject({
      status: 'PAID',
      amountPaid: first.total,
      balanceDue: 0,
    });
    expect(paid.body.paidAt).not.toBeNull();

    const partial = await call('get', `/invoices/${second.id}`, viewerToken, acmeId).expect(200);
    expect(partial.body).toMatchObject({
      status: 'PARTIAL',
      amountPaid: 400,
      balanceDue: second.total - 400,
      paidAt: null,
    });

    const journals = await journalEntriesFor(payment.id);
    expect(journals).toHaveLength(1);
    const debit = journals[0].lines.reduce((sum, line) => sum + line.debit, 0);
    const credit = journals[0].lines.reduce((sum, line) => sum + line.credit, 0);
    expect(debit).toBe(amount);
    expect(credit).toBe(amount);

    await call('post', '/payments', staffToken, acmeId)
      .send({
        customerId,
        date: '2026-11-16',
        amount: 10,
        applications: [{ invoiceId: first.id, amount: 10 }],
      })
      .expect(400);
  });

  it('rejects over-application and payments that do not match their applications', async () => {
    const invoice = await createSentInvoice('TEST PAY overpaid invoice');
    const countBefore = await prisma.payment.count({
      where: { notes: { startsWith: 'TEST PAY' } },
    });

    await call('post', '/payments', staffToken, acmeId)
      .send({
        customerId,
        date: '2026-11-16',
        amount: invoice.total + 0.01,
        applications: [{ invoiceId: invoice.id, amount: invoice.total + 0.01 }],
      })
      .expect(400);

    await call('post', '/payments', staffToken, acmeId)
      .send({
        customerId,
        date: '2026-11-16',
        amount: 100,
        applications: [{ invoiceId: invoice.id, amount: 90 }],
      })
      .expect(400);

    expect(
      await prisma.payment.count({ where: { notes: { startsWith: 'TEST PAY' } } }),
    ).toBe(countBefore);
    const detail = await call('get', `/invoices/${invoice.id}`, viewerToken, acmeId).expect(200);
    expect(detail.body).toMatchObject({ status: 'SENT', amountPaid: 0 });
  });

  it('validates open invoices, applications, permissions, tenancy, and auditing', async () => {
    const draft = await call('post', '/invoices', staffToken, acmeId)
      .send({
        customerId,
        issueDate: '2026-11-01',
        dueDate: '2026-12-01',
        notes: 'TEST PAY draft invoice',
        lines: [{ itemId: hourlyItemId, quantity: 1 }],
      })
      .expect(201);
    await call('post', '/payments', staffToken, acmeId)
      .send({
        customerId,
        amount: 10,
        applications: [{ invoiceId: draft.body.id, amount: 10 }],
      })
      .expect(400);

    const invoice = await createSentInvoice('TEST PAY audit invoice');
    const validBody = {
      customerId,
      date: '2026-11-16',
      amount: 100,
      applications: [{ invoiceId: invoice.id, amount: 100 }],
    };
    await call('post', '/payments', viewerToken, acmeId).send(validBody).expect(403);
    await call('post', '/payments', staffToken, acmeId)
      .send({
        ...validBody,
        applications: [
          { invoiceId: invoice.id, amount: 50 },
          { invoiceId: invoice.id, amount: 50 },
        ],
      })
      .expect(400);
    await call('post', '/payments', staffToken, acmeId)
      .send({ ...validBody, surprise: true })
      .expect(400);
    await call('post', '/payments', nimbusOwnerToken, nimbusId)
      .send({
        customerId: nimbusCustomerId,
        amount: 10,
        applications: [{ invoiceId: invoice.id, amount: 10 }],
      })
      .expect(400);

    const payment = await createPayment(invoice.id, 100, { notes: 'TEST PAY audited receipt' });
    await call('get', `/payments/${payment.id}`, nimbusOwnerToken, nimbusId).expect(404);
    const foreignList = await call('get', '/payments', nimbusOwnerToken, nimbusId).expect(200);
    expect(foreignList.body.payments).toHaveLength(0);

    const list = await call(
      'get',
      `/payments?search=${encodeURIComponent(payment.number)}`,
      viewerToken,
      acmeId,
    ).expect(200);
    expect(list.body.payments).toHaveLength(1);
    expect(list.body.payments[0]).toMatchObject({
      id: payment.id,
      customerId,
      amount: 100,
    });
    expect(list.body.payments[0].applications[0].invoice.number).toBe(invoice.number);

    const audit = await call(
      'get',
      '/audit-log?action=payment.create&limit=100',
      ownerToken,
      acmeId,
    ).expect(200);
    const entry = (audit.body.entries as Array<{
      entityId: string;
      metadata: { invoiceNumbers?: string[] };
    }>).find((row) => row.entityId === payment.id);
    expect(entry?.metadata.invoiceNumbers).toContain(invoice.number);
  });

  it('serializes concurrent payments so an invoice cannot be over-applied', async () => {
    const invoice = await createSentInvoice('TEST PAY concurrent invoice');
    const results = await Promise.all([
      call('post', '/payments', staffToken, acmeId).send({
        customerId,
        date: '2026-11-16',
        amount: 800,
        notes: 'TEST PAY concurrent receipt',
        applications: [{ invoiceId: invoice.id, amount: 800 }],
      }),
      call('post', '/payments', staffToken, acmeId).send({
        customerId,
        date: '2026-11-16',
        amount: 800,
        notes: 'TEST PAY concurrent receipt',
        applications: [{ invoiceId: invoice.id, amount: 800 }],
      }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 400]);

    const detail = await call('get', `/invoices/${invoice.id}`, viewerToken, acmeId).expect(200);
    expect(detail.body).toMatchObject({
      status: 'PARTIAL',
      amountPaid: 800,
      balanceDue: invoice.total - 800,
    });
    expect(await prisma.paymentApplication.count({ where: { invoiceId: invoice.id } })).toBe(1);
  });

});
