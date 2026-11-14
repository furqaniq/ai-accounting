import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.factory';
import { PrismaService } from '../prisma/prisma.service';

interface LineView {
  itemId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  taxable: boolean;
  incomeAccountId: string;
}

interface InvoiceView {
  id: string;
  number: string;
  status: string;
  customerId: string;
  dueDate: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  daysOverdue: number;
  lines: LineView[];
  sentAt: string | null;
}

interface JournalEntryView {
  id: string;
  reference: string;
  sourceType: string;
  sourceId: string | null;
  lines: Array<{
    accountId: string;
    debit: number;
    credit: number;
  }>;
}

interface CustomerView {
  id: string;
  balance: number;
}

describe('Invoices', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let accountantToken: string;
  let staffToken: string;
  let viewerToken: string;
  let nimbusOwnerToken: string;
  let acmeId: string;
  let nimbusId: string;
  let customerId: string;
  let nimbusCustomerId: string;
  let hourlyItemId: string;
  let packageItemId: string;
  let arAccountId: string;
  let taxAccountId: string;
  let incomeAccountId: string;
  let draftId: string;
  let sentId: string;

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

  async function customerBalance(): Promise<number> {
    const res = await call('get', `/customers/${customerId}`, ownerToken, acmeId).expect(200);
    return (res.body as CustomerView).balance;
  }

  async function journalEntriesFor(invoiceId: string): Promise<JournalEntryView[]> {
    const res = await call('get', '/journal-entries?limit=200', ownerToken, acmeId).expect(200);
    return (res.body.entries as JournalEntryView[]).filter(
      (entry) => entry.sourceType === 'INVOICE' && entry.sourceId === invoiceId,
    );
  }

  async function clearTestRows(): Promise<void> {
    const invoices = await prisma.invoice.findMany({
      where: { notes: { startsWith: 'TEST ' } },
      select: { id: true },
    });
    const ids = invoices.map((invoice) => invoice.id);
    if (ids.length > 0) {
      await prisma.journalEntry.deleteMany({
        where: { sourceType: 'INVOICE', sourceId: { in: ids } },
      });
      await prisma.invoice.deleteMany({ where: { id: { in: ids } } });
    }
  }

  async function createInvoice(
    overrides: Record<string, unknown> = {},
    token = staffToken,
  ): Promise<InvoiceView> {
    const res = await call('post', '/invoices', token, acmeId)
      .send({
        customerId,
        issueDate: '2026-11-01',
        dueDate: '2026-12-01',
        taxRate: 0.0825,
        notes: 'TEST invoice',
        lines: [
          { itemId: hourlyItemId, quantity: 2, unitPrice: 150 },
          { itemId: packageItemId, quantity: 1, unitPrice: 900 },
        ],
        ...overrides,
      })
      .expect(201);
    return res.body as InvoiceView;
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
    arAccountId = rows.find((account) => account.code === '1100')!.id;
    taxAccountId = rows.find((account) => account.code === '2100')!.id;
    incomeAccountId = rows.find((account) => account.code === '4000')!.id;
  });

  afterAll(async () => {
    await clearTestRows();
    await app.close();
  });

  it('creates a draft with computed subtotal, tax, total, and due date', async () => {
    const beforeBalance = await customerBalance();
    const invoice = await createInvoice();
    draftId = invoice.id;

    expect(invoice).toMatchObject({
      status: 'DRAFT',
      customerId,
      dueDate: '2026-12-01',
      subtotal: 1200,
      taxTotal: 74.25,
      total: 1274.25,
      amountPaid: 0,
      balanceDue: 1274.25,
      sentAt: null,
    });
    expect(invoice.number).toMatch(/^INV-\d{4}$/);
    expect(invoice.lines).toHaveLength(2);
    expect(invoice.lines.map((line) => line.amount)).toEqual([300, 900]);

    const detail = await call('get', `/invoices/${draftId}`, viewerToken, acmeId).expect(200);
    expect(detail.body).toMatchObject({ id: draftId, status: 'DRAFT', total: 1274.25 });
    expect(await journalEntriesFor(draftId)).toHaveLength(0);
    expect(await customerBalance()).toBe(beforeBalance);
  });

  it('validates customer, items, dates, quantities, and unknown fields', async () => {
    const cases: Array<Record<string, unknown>> = [
      { customerId: 'missing' },
      { customerId: nimbusCustomerId },
      { lines: [] },
      { lines: [{ itemId: 'missing', quantity: 1 }] },
      { dueDate: '2026-10-01' },
      { dueDate: 'not-a-date' },
      { taxRate: 1.5 },
      { lines: [{ itemId: hourlyItemId, quantity: 0 }] },
      { lines: [{ itemId: hourlyItemId, quantity: 1, unitPrice: -1 }] },
      { status: 'SENT' },
    ];
    for (const body of cases) {
      await call('post', '/invoices', accountantToken, acmeId)
        .send({
          customerId,
          issueDate: '2026-11-01',
          dueDate: '2026-12-01',
          lines: [{ itemId: hourlyItemId, quantity: 1 }],
          ...body,
        })
        .expect(400);
    }
  });

  it('edits a draft, recomputes totals, and rejects unknown fields', async () => {
    const edited = await call('patch', `/invoices/${draftId}`, staffToken, acmeId)
      .send({
        dueDate: '2026-12-15',
        taxRate: 0,
        notes: 'TEST edited invoice',
        lines: [{ itemId: hourlyItemId, quantity: 3, unitPrice: 100 }],
      })
      .expect(200);

    expect(edited.body).toMatchObject({
      dueDate: '2026-12-15',
      subtotal: 300,
      taxTotal: 0,
      total: 300,
      notes: 'TEST edited invoice',
    });
    expect((edited.body as InvoiceView).lines).toHaveLength(1);

    await call('patch', `/invoices/${draftId}`, staffToken, acmeId)
      .send({ status: 'SENT' })
      .expect(400);
    await call('patch', `/invoices/${draftId}`, staffToken, acmeId)
      .send({ customerId: 'missing' })
      .expect(400);
  });

  it('sends once, posts balanced receivable/income/tax lines, and updates customer balance', async () => {
    const sent = await createInvoice();
    sentId = sent.id;
    const beforeBalance = await customerBalance();

    const first = await call('post', `/invoices/${sentId}/send`, staffToken, acmeId).expect(201);
    expect(first.body).toMatchObject({ status: 'SENT', total: 1274.25 });
    expect((first.body as InvoiceView).sentAt).not.toBeNull();

    const entries = await journalEntriesFor(sentId);
    expect(entries).toHaveLength(1);
    expect(entries[0].reference).toMatch(/^JE-\d{4}$/);
    const lines = entries[0].lines;
    expect(lines.find((line) => line.accountId === arAccountId)).toMatchObject({
      debit: 1274.25,
      credit: 0,
    });
    expect(lines.find((line) => line.accountId === incomeAccountId)).toMatchObject({
      debit: 0,
      credit: 1200,
    });
    expect(lines.find((line) => line.accountId === taxAccountId)).toMatchObject({
      debit: 0,
      credit: 74.25,
    });
    expect(lines.reduce((sum, line) => sum + line.debit, 0)).toBe(1274.25);
    expect(lines.reduce((sum, line) => sum + line.credit, 0)).toBe(1274.25);
    expect(await customerBalance()).toBe(Number((beforeBalance + 1274.25).toFixed(2)));

    const second = await call('post', `/invoices/${sentId}/send`, ownerToken, acmeId).expect(201);
    expect(second.body.status).toBe('SENT');
    expect(await journalEntriesFor(sentId)).toHaveLength(1);

    await call('patch', `/invoices/${sentId}`, staffToken, acmeId)
      .send({ notes: 'TEST should fail' })
      .expect(400);
  });

  it('derives overdue status and filters invoices by status', async () => {
    const overdue = await createInvoice({
      issueDate: '2026-09-01',
      dueDate: '2026-09-30',
      notes: 'TEST overdue invoice',
      lines: [{ itemId: hourlyItemId, quantity: 1, unitPrice: 150 }],
    });
    await call('post', `/invoices/${overdue.id}/send`, staffToken, acmeId).expect(201);

    const detail = await call('get', `/invoices/${overdue.id}`, staffToken, acmeId).expect(200);
    expect(detail.body).toMatchObject({ status: 'OVERDUE' });
    expect((detail.body as InvoiceView).daysOverdue).toBeGreaterThan(0);

    const overdueList = await call('get', '/invoices?status=OVERDUE', staffToken, acmeId).expect(
      200,
    );
    expect(
      (overdueList.body.invoices as InvoiceView[]).some((invoice) => invoice.id === overdue.id),
    ).toBe(true);

    const sentList = await call('get', '/invoices?status=SENT', staffToken, acmeId).expect(200);
    expect(
      (sentList.body.invoices as InvoiceView[]).some((invoice) => invoice.id === overdue.id),
    ).toBe(false);

    const draftList = await call('get', '/invoices?status=DRAFT', staffToken, acmeId).expect(200);
    expect(
      (draftList.body.invoices as InvoiceView[]).some((invoice) => invoice.id === draftId),
    ).toBe(true);

    const searched = await call('get', '/invoices?search=Northwind', staffToken, acmeId).expect(
      200,
    );
    expect(
      (searched.body.invoices as InvoiceView[]).some((invoice) => invoice.id === overdue.id),
    ).toBe(true);
  });

  it('keeps invoices tenant-scoped and read-only for viewers', async () => {
    const viewerList = await call('get', '/invoices', viewerToken, acmeId).expect(200);
    expect(viewerList.body.invoices.length).toBeGreaterThan(0);
    await call('get', `/invoices/${sentId}`, viewerToken, acmeId).expect(200);

    await call('post', '/invoices', viewerToken, acmeId)
      .send({
        customerId,
        dueDate: '2026-12-01',
        lines: [{ itemId: hourlyItemId, quantity: 1 }],
      })
      .expect(403);
    await call('patch', `/invoices/${draftId}`, viewerToken, acmeId)
      .send({ notes: 'blocked' })
      .expect(403);
    await call('post', `/invoices/${draftId}/send`, viewerToken, acmeId).expect(403);

    const nimbusList = await call('get', '/invoices', nimbusOwnerToken, nimbusId).expect(200);
    expect(
      (nimbusList.body.invoices as InvoiceView[]).some((invoice) => invoice.id === sentId),
    ).toBe(false);
    await call('get', `/invoices/${sentId}`, nimbusOwnerToken, nimbusId).expect(404);
    await call('post', `/invoices/${sentId}/send`, nimbusOwnerToken, nimbusId).expect(404);
    await call('patch', `/invoices/${sentId}`, nimbusOwnerToken, nimbusId)
      .send({ notes: 'cross tenant' })
      .expect(404);
  });

  it('audits invoice creation, edits, and sending', async () => {
    const audit = await call('get', '/audit-log?entityType=Invoice&limit=50', ownerToken, acmeId)
      .expect(200);
    const actions = (audit.body.entries as Array<{ action: string; entityId: string }>).map(
      (entry) => entry.action,
    );
    expect(actions).toEqual(
      expect.arrayContaining(['invoice.create', 'invoice.update', 'invoice.send']),
    );
  });
});
