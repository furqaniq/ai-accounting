import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.factory';
import { PrismaService } from '../prisma/prisma.service';

interface EstimateLineView {
  itemId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  taxable: boolean;
  incomeAccountId: string;
}

interface ConvertedInvoiceView {
  id: string;
  number: string;
  status: string;
}

interface EstimateView {
  id: string;
  number: string;
  status: string;
  customerId: string;
  issueDate: string;
  expiryDate: string | null;
  subtotal: number;
  taxRate: number;
  taxTotal: number;
  total: number;
  notes: string | null;
  convertedInvoice: ConvertedInvoiceView | null;
  lines: EstimateLineView[];
}

interface JournalEntryView {
  sourceType: string;
  sourceId: string | null;
}

describe('Estimates', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let staffToken: string;
  let viewerToken: string;
  let nimbusOwnerToken: string;
  let acmeId: string;
  let nimbusId: string;
  let nimbusCustomerId: string;
  let customerId: string;
  let hourlyItemId: string;
  let packageItemId: string;

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
    const estimates = await prisma.estimate.findMany({
      where: { notes: { startsWith: 'TEST ' } },
      select: { id: true, convertedInvoiceId: true },
    });
    const ids = estimates.map((estimate) => estimate.id);
    if (ids.length === 0) return;
    const invoiceIds = estimates
      .map((estimate) => estimate.convertedInvoiceId)
      .filter((id): id is string => Boolean(id));
    await prisma.estimate.updateMany({
      where: { id: { in: ids } },
      data: { convertedInvoiceId: null },
    });
    await prisma.estimate.deleteMany({ where: { id: { in: ids } } });
    if (invoiceIds.length > 0) {
      await prisma.journalEntry.deleteMany({
        where: { sourceType: 'INVOICE', sourceId: { in: invoiceIds } },
      });
      await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    }
  }

  async function createEstimate(
    overrides: Record<string, unknown> = {},
  ): Promise<EstimateView> {
    const res = await call('post', '/estimates', staffToken, acmeId)
      .send({
        customerId,
        issueDate: '2026-11-10',
        expiryDate: '2026-12-10',
        taxRate: 0.0825,
        notes: 'TEST estimate',
        lines: [
          { itemId: hourlyItemId, quantity: 2, unitPrice: 150 },
          { itemId: packageItemId, quantity: 1, unitPrice: 900 },
        ],
        ...overrides,
      })
      .expect(201);
    return res.body as EstimateView;
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
  });

  afterAll(async () => {
    await clearTestRows();
    await app.close();
  });

  it('creates a draft estimate with computed subtotal, tax, total, and expiry', async () => {
    const estimate = await createEstimate();

    expect(estimate).toMatchObject({
      status: 'DRAFT',
      customerId,
      issueDate: '2026-11-10',
      expiryDate: '2026-12-10',
      subtotal: 1200,
      taxRate: 0.0825,
      taxTotal: 74.25,
      total: 1274.25,
      convertedInvoice: null,
    });
    expect(estimate.number).toMatch(/^EST-\d{4}$/);
    expect(estimate.lines).toHaveLength(2);
    expect(estimate.lines.map((line) => line.amount)).toEqual([300, 900]);

    const detail = await call('get', `/estimates/${estimate.id}`, viewerToken, acmeId).expect(200);
    expect(detail.body).toMatchObject({ id: estimate.id, total: 1274.25 });
  });
  it('edits a draft estimate and exposes it through list and detail', async () => {
    const estimate = await createEstimate({ notes: 'TEST editable estimate' });

    const updated = await call('patch', `/estimates/${estimate.id}`, staffToken, acmeId)
      .send({ expiryDate: '2026-12-20', taxRate: 0, notes: 'TEST revised', lines: [
        { itemId: packageItemId, quantity: 2, unitPrice: 900 },
      ] })
      .expect(200);

    expect(updated.body).toMatchObject({
      status: 'DRAFT',
      expiryDate: '2026-12-20',
      taxRate: 0,
      subtotal: 1800,
      taxTotal: 0,
      total: 1800,
      notes: 'TEST revised',
    });
    expect(updated.body.lines).toHaveLength(1);

    const list = await call('get', '/estimates?search=TEST%20revised', viewerToken, acmeId)
      .expect(200);
    expect(list.body.estimates).toHaveLength(1);
    expect(list.body.estimates[0]).toMatchObject({ id: estimate.id, total: 1800 });
  });

  it('allows only draft estimates to be edited', async () => {
    const estimate = await createEstimate({ notes: 'TEST locked estimate' });
    await call('post', `/estimates/${estimate.id}/status`, staffToken, acmeId)
      .send({ status: 'SENT' })
      .expect(201);

    await call('patch', `/estimates/${estimate.id}`, staffToken, acmeId)
      .send({ notes: 'TEST changed after send' })
      .expect(400);
  });

  it('converts an accepted estimate into a draft invoice without posting to the ledger', async () => {
    const estimate = await createEstimate({ notes: 'TEST convert estimate' });
    await call('post', `/estimates/${estimate.id}/status`, staffToken, acmeId)
      .send({ status: 'SENT' })
      .expect(201);
    const accepted = await call('post', `/estimates/${estimate.id}/status`, staffToken, acmeId)
      .send({ status: 'ACCEPTED' })
      .expect(201);
    expect(accepted.body.status).toBe('ACCEPTED');
    expect(accepted.body.convertedInvoice).toBeNull();

    const converted = await call('post', `/estimates/${estimate.id}/convert`, staffToken, acmeId)
      .expect(201);
    const convertedEstimate = converted.body as EstimateView;

    expect(convertedEstimate.status).toBe('ACCEPTED');
    expect(convertedEstimate.convertedInvoice).toMatchObject({ status: 'DRAFT' });
    expect(convertedEstimate.convertedInvoice?.number).toMatch(/^INV-\d{4}$/);

    const invoiceRes = await call(
      'get',
      `/invoices/${convertedEstimate.convertedInvoice!.id}`,
      viewerToken,
      acmeId,
    ).expect(200);
    expect(invoiceRes.body).toMatchObject({
      status: 'DRAFT',
      customerId,
      subtotal: estimate.subtotal,
      taxTotal: estimate.taxTotal,
      total: estimate.total,
      amountPaid: 0,
    });
    expect(invoiceRes.body.lines.map((line: EstimateLineView) => ({
      itemId: line.itemId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      amount: line.amount,
    }))).toEqual(estimate.lines.map((line) => ({
      itemId: line.itemId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      amount: line.amount,
    })));

    const journal = await call('get', '/journal-entries?limit=200', ownerToken, acmeId).expect(200);
    expect((journal.body.entries as JournalEntryView[]).filter(
      (entry) =>
        entry.sourceType === 'INVOICE' &&
        entry.sourceId === convertedEstimate.convertedInvoice!.id,
    )).toHaveLength(0);

    await call(
      'post',
      `/invoices/${convertedEstimate.convertedInvoice!.id}/send`,
      staffToken,
      acmeId,
    ).expect(201);
    const posted = await call('get', '/journal-entries?limit=200', ownerToken, acmeId).expect(200);
    expect((posted.body.entries as JournalEntryView[]).filter(
      (entry) =>
        entry.sourceType === 'INVOICE' &&
        entry.sourceId === convertedEstimate.convertedInvoice!.id,
    )).toHaveLength(1);
  });

  it('refuses to convert the same estimate twice and explains the existing link', async () => {
    const estimate = await createEstimate({ notes: 'TEST duplicate conversion' });
    await call('post', `/estimates/${estimate.id}/status`, staffToken, acmeId)
      .send({ status: 'ACCEPTED' })
      .expect(201);
    const first = await call('post', `/estimates/${estimate.id}/convert`, staffToken, acmeId)
      .expect(201);
    const invoiceNumber = first.body.convertedInvoice.number as string;

    const duplicate = await call('post', `/estimates/${estimate.id}/convert`, staffToken, acmeId)
      .expect(409);
    expect(duplicate.body.message).toContain(invoiceNumber);

    const detail = await call('get', `/estimates/${estimate.id}`, viewerToken, acmeId).expect(200);
    expect(detail.body.convertedInvoice.number).toBe(invoiceNumber);
  });

  it('allows conversion only after the estimate is accepted', async () => {
    const estimate = await createEstimate({ notes: 'TEST unaccepted conversion' });
    await call('post', `/estimates/${estimate.id}/convert`, staffToken, acmeId).expect(400);
  });

  it('validates customer, item, date, and unknown-field input', async () => {
    const cases: Array<Record<string, unknown>> = [
      { customerId: 'missing' },
      { customerId: nimbusCustomerId },
      { lines: [] },
      { lines: [{ itemId: 'missing', quantity: 1 }] },
      { lines: [{ itemId: packageItemId, quantity: 0 }] },
      { issueDate: '2026-12-01', expiryDate: '2026-11-01' },
      { surprise: true },
    ];
    for (const body of cases) {
      await call('post', '/estimates', staffToken, acmeId)
        .send({
          customerId,
          issueDate: '2026-11-10',
          taxRate: 0,
          notes: 'TEST invalid estimate',
          lines: [{ itemId: hourlyItemId, quantity: 1 }],
          ...body,
        })
        .expect(400);
    }
  });

  it('enforces manage permission and organization isolation', async () => {
    await call('post', '/estimates', viewerToken, acmeId)
      .send({
        customerId,
        issueDate: '2026-11-10',
        lines: [{ itemId: hourlyItemId, quantity: 1 }],
      })
      .expect(403);

    const estimate = await createEstimate({ notes: 'TEST isolated estimate' });
    await call('get', `/estimates/${estimate.id}`, nimbusOwnerToken, nimbusId).expect(404);

    await call('post', `/estimates/${estimate.id}/status`, nimbusOwnerToken, nimbusId)
      .send({ status: 'ACCEPTED' })
      .expect(404);

    await call('post', `/estimates/${estimate.id}/convert`, viewerToken, acmeId).expect(403);
  });

  it('audits estimate creation, status changes, and conversion', async () => {
    const estimate = await createEstimate({ notes: 'TEST audited estimate' });
    await call('post', `/estimates/${estimate.id}/status`, staffToken, acmeId)
      .send({ status: 'ACCEPTED' })
      .expect(201);
    const converted = await call('post', `/estimates/${estimate.id}/convert`, staffToken, acmeId)
      .expect(201);

    const res = await call('get', '/audit-log?entityType=Estimate&limit=100', ownerToken, acmeId)
      .expect(200);
    const entries = (res.body.entries as Array<{
      action: string;
      entityId: string;
      metadata: { invoiceNumber?: string };
    }>).filter((entry) => entry.entityId === estimate.id);
    expect(entries.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(['estimate.create', 'estimate.status', 'estimate.convert']),
    );
    const convertEntry = entries.find((entry) => entry.action === 'estimate.convert');
    expect(convertEntry?.metadata.invoiceNumber).toBe(converted.body.convertedInvoice.number);

    const invoices = await call('get', '/audit-log?entityType=Invoice&limit=100', ownerToken, acmeId)
      .expect(200);
    expect((invoices.body.entries as Array<{ entityId: string; metadata: { sourceEstimateId?: string } }>).some(
      (entry) =>
        entry.entityId === converted.body.convertedInvoice.id &&
        entry.metadata.sourceEstimateId === estimate.id,
    )).toBe(true);
  });

});
