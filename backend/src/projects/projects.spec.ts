import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.factory';
import { PrismaService } from '../prisma/prisma.service';

interface ProjectView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  customerId: string | null;
  billingItemId: string | null;
  defaultRate: number | null;
  active: boolean;
  profitability: {
    revenue: number;
    expenses: number;
    profit: number;
    billableValue: number;
    invoicedValue: number;
    unbilledValue: number;
    billableHours: number;
    invoicedHours: number;
    unbilledHours: number;
    invoiceCount: number;
    expenseCount: number;
    timeEntryCount: number;
  };
}

interface TimeEntryView {
  id: string;
  date: string;
  projectId: string | null;
  userId: string;
  user: { id: string; name: string };
  hours: number;
  rate: number;
  amount: number;
  billable: boolean;
  notes: string | null;
  invoice: { id: string; number: string; status: string; lineId: string } | null;
}

interface InvoiceView {
  id: string;
  number: string;
  status: string;
  projectId: string | null;
  project: { id: string; name: string } | null;
  subtotal: number;
  total: number;
  lines: Array<{
    id: string;
    itemId: string;
    description: string;
    quantity: number;
    unitPrice: number;
    amount: number;
    timeEntry: { id: string; hours: number; rate: number } | null;
  }>;
}

interface ExpenseView {
  id: string;
  number: string;
  projectId: string | null;
  project: { id: string; name: string } | null;
  amount: number;
  version: number;
}

describe('Projects and time', () => {
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
  let itemId: string;
  let nimbusItemId: string;
  let suppliesAccountId: string;
  let nimbusSuppliesAccountId: string;

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
    const projects = await prisma.project.findMany({
      where: { name: { startsWith: 'TEST PROJ' } },
      select: { id: true },
    });
    const projectIds = projects.map((project) => project.id);
    const expenses = await prisma.expense.findMany({
      where: { memo: { startsWith: 'TEST PROJ' } },
      select: { id: true },
    });
    const expenseIds = expenses.map((expense) => expense.id);
    const invoices = await prisma.invoice.findMany({
      where: {
        OR: [
          { notes: { startsWith: 'TEST PROJ' } },
          { notes: { startsWith: 'TEST TIME' } },
        ],
      },
      select: { id: true },
    });
    const invoiceIds = invoices.map((invoice) => invoice.id);
    const timeEntries = await prisma.timeEntry.findMany({
      where: {
        OR: [
          { projectId: { in: projectIds } },
          { notes: { startsWith: 'TEST TIME' } },
        ],
      },
      select: { id: true },
    });

    if (expenseIds.length > 0) {
      await prisma.journalEntry.deleteMany({
        where: {
          sourceType: 'EXPENSE',
          OR: expenseIds.map((id) => ({ sourceId: { startsWith: id } })),
        },
      });
      await prisma.expense.deleteMany({ where: { id: { in: expenseIds } } });
    }
    if (invoiceIds.length > 0) {
      await prisma.journalEntry.deleteMany({
        where: { sourceType: 'INVOICE', sourceId: { in: invoiceIds } },
      });
      await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    }
    if (timeEntries.length > 0) {
      await prisma.timeEntry.deleteMany({
        where: { id: { in: timeEntries.map((entry) => entry.id) } },
      });
    }
    if (projectIds.length > 0) {
      await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    }
  }

  async function createProject(
    overrides: Record<string, unknown> = {},
    token = staffToken,
    orgId = acmeId,
  ): Promise<ProjectView> {
    const res = await call('post', '/projects', token, orgId)
      .send({
        name: 'TEST PROJ Alpha',
        description: 'TEST PROJ description',
        customerId,
        billingItemId: itemId,
        defaultRate: 150,
        ...overrides,
      })
      .expect(201);
    return res.body as ProjectView;
  }

  async function createTime(
    input: Record<string, unknown>,
    token = staffToken,
    orgId = acmeId,
  ): Promise<TimeEntryView> {
    const res = await call('post', '/time-entries', token, orgId)
      .send(input)
      .expect(201);
    return res.body as TimeEntryView;
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

    const [acmeCustomers, nimbusCustomers, acmeItems, nimbusItems, acmeAccounts, nimbusAccounts] =
      await Promise.all([
        call('get', '/customers', ownerToken, acmeId).expect(200),
        call('get', '/customers', nimbusOwnerToken, nimbusId).expect(200),
        call('get', '/items', ownerToken, acmeId).expect(200),
        call('get', '/items', nimbusOwnerToken, nimbusId).expect(200),
        call('get', '/accounts', ownerToken, acmeId).expect(200),
        call('get', '/accounts', nimbusOwnerToken, nimbusId).expect(200),
      ]);

    customerId = (acmeCustomers.body.customers as Array<{ id: string }>)[0].id;
    nimbusCustomerId = (nimbusCustomers.body.customers as Array<{ id: string }>)[0].id;
    itemId = (acmeItems.body.items as Array<{ id: string; active: boolean }>).find(
      (item) => item.active,
    )!.id;
    nimbusItemId = (nimbusItems.body.items as Array<{ id: string; active: boolean }>).find(
      (item) => item.active,
    )!.id;
    suppliesAccountId = (acmeAccounts.body.accounts as Array<{ id: string; code: string }>).find(
      (account) => account.code === '6200',
    )!.id;
    nimbusSuppliesAccountId = (
      nimbusAccounts.body.accounts as Array<{ id: string; code: string }>
    ).find((account) => account.code === '6200')!.id;
  });

  beforeEach(async () => {
    await clearTestRows();
  });

  afterAll(async () => {
    await clearTestRows();
    await app.close();
  });

  it('creates, lists, edits, audits, and isolates projects', async () => {
    const project = await createProject();
    expect(project.code).toMatch(/^PROJ-\d{4}$/);
    expect(project).toMatchObject({
      name: 'TEST PROJ Alpha',
      customerId,
      billingItemId: itemId,
      defaultRate: 150,
      active: true,
    });
    expect(project.profitability.revenue).toBe(0);

    const list = await call('get', '/projects?search=TEST PROJ Alpha', ownerToken, acmeId).expect(
      200,
    );
    expect((list.body.projects as ProjectView[]).map((row) => row.id)).toContain(project.id);

    const updated = await call('patch', `/projects/${project.id}`, staffToken, acmeId)
      .send({ name: 'TEST PROJ Alpha renamed', defaultRate: 175, active: false })
      .expect(200);
    expect(updated.body).toMatchObject({
      name: 'TEST PROJ Alpha renamed',
      defaultRate: 175,
      active: false,
    });

    const audit = await call(
      'get',
      '/audit-log?entityType=Project&limit=50',
      ownerToken,
      acmeId,
    ).expect(200);
    const actions = (audit.body.entries as Array<{ action: string; entityId: string }>)
      .filter((entry) => entry.entityId === project.id)
      .map((entry) => entry.action);
    expect(actions).toContain('project.create');
    expect(actions).toContain('project.update');

    const viewerList = await call('get', '/projects', viewerToken, acmeId).expect(200);
    expect(Array.isArray(viewerList.body.projects)).toBe(true);
    await call('post', '/projects', viewerToken, acmeId)
      .send({ name: 'TEST PROJ Viewer' })
      .expect(403);
    await call('patch', `/projects/${project.id}`, viewerToken, acmeId)
      .send({ name: 'TEST PROJ Viewer' })
      .expect(403);

    await call('get', `/projects/${project.id}`, nimbusOwnerToken, nimbusId).expect(404);
    await call('patch', `/projects/${project.id}`, nimbusOwnerToken, nimbusId)
      .send({ name: 'TEST PROJ stolen' })
      .expect(404);
    await call('post', '/projects', nimbusOwnerToken, nimbusId)
      .send({ name: 'TEST PROJ Nimbus bad customer', customerId })
      .expect(400);
  });

  it('records time with a member, totals hours by rate, and restricts views', async () => {
    const project = await createProject();
    const entry = await createTime({
      projectId: project.id,
      date: '2026-11-10',
      hours: 2.5,
      notes: 'TEST TIME design work',
    });
    expect(entry).toMatchObject({
      projectId: project.id,
      hours: 2.5,
      rate: 150,
      amount: 375,
      billable: true,
      notes: 'TEST TIME design work',
    });
    expect(entry.user.name).toBeTruthy();
    expect(entry.userId).toBeTruthy();

    const loose = await createTime({
      date: '2026-11-11',
      hours: 1.5,
      rate: 80,
      billable: false,
      notes: 'TEST TIME admin',
    });
    expect(loose.projectId).toBeNull();
    expect(loose.amount).toBe(120);

    const list = await call(
      'get',
      `/time-entries?projectId=${project.id}`,
      viewerToken,
      acmeId,
    ).expect(200);
    expect(list.body.timeEntries).toHaveLength(1);

    const edited = await call('patch', `/time-entries/${entry.id}`, staffToken, acmeId)
      .send({ hours: 3, rate: 125, notes: 'TEST TIME edited' })
      .expect(200);
    expect(edited.body).toMatchObject({ hours: 3, rate: 125, amount: 375 });

    await call('post', '/time-entries', viewerToken, acmeId)
      .send({ hours: 1, rate: 10 })
      .expect(403);
    await call('patch', `/time-entries/${entry.id}`, viewerToken, acmeId)
      .send({ hours: 1 })
      .expect(403);

    await call('delete', `/time-entries/${loose.id}`, staffToken, acmeId).expect(200);
    const remaining = await call('get', '/time-entries', ownerToken, acmeId).expect(200);
    expect(
      (remaining.body.timeEntries as TimeEntryView[]).some((row) => row.id === loose.id),
    ).toBe(false);

    await call('post', '/time-entries', nimbusOwnerToken, nimbusId)
      .send({ hours: 1, rate: 10, projectId: project.id })
      .expect(400);
  });

  it('tags invoices and expenses, then reconciles project profitability', async () => {
    const project = await createProject();
    const invoice = await call('post', '/invoices', staffToken, acmeId)
      .send({
        customerId,
        projectId: project.id,
        issueDate: '2026-11-01',
        dueDate: '2026-11-30',
        taxRate: 0,
        notes: 'TEST PROJ invoice',
        lines: [{ itemId, quantity: 2, unitPrice: 500 }],
      })
      .expect(201);
    const invoiceView = invoice.body as InvoiceView;
    expect(invoiceView.projectId).toBe(project.id);
    expect(invoiceView.project?.name).toBe('TEST PROJ Alpha');
    expect(invoiceView.status).toBe('DRAFT');

    let summary = await call('get', `/projects/${project.id}`, ownerToken, acmeId).expect(200);
    expect(summary.body.project.profitability.revenue).toBe(0);
    expect(summary.body.invoices).toHaveLength(1);

    await call('post', `/invoices/${invoiceView.id}/send`, staffToken, acmeId).expect(201);

    const expense = await call('post', '/expenses', staffToken, acmeId)
      .send({
        date: '2026-11-12',
        categoryAccountId: suppliesAccountId,
        projectId: project.id,
        amount: 200,
        memo: 'TEST PROJ expense',
      })
      .expect(201);
    expect((expense.body as ExpenseView).projectId).toBe(project.id);
    expect((expense.body as ExpenseView).project?.name).toBe('TEST PROJ Alpha');

    const expenseId = (expense.body as ExpenseView).id;
    const journalsBefore = await prisma.journalEntry.count({
      where: { organizationId: acmeId, sourceType: 'EXPENSE', sourceId: { startsWith: expenseId } },
    });
    const moved = await call('patch', `/expenses/${expenseId}`, staffToken, acmeId)
      .send({ projectId: '' })
      .expect(200);
    expect((moved.body as ExpenseView).projectId).toBeNull();
    expect((moved.body as ExpenseView).version).toBe(1);
    const journalsAfter = await prisma.journalEntry.count({
      where: { organizationId: acmeId, sourceType: 'EXPENSE', sourceId: { startsWith: expenseId } },
    });
    expect(journalsAfter).toBe(journalsBefore);
    await call('patch', `/expenses/${expenseId}`, staffToken, acmeId)
      .send({ projectId: project.id })
      .expect(200);

    await createTime({ projectId: project.id, date: '2026-11-10', hours: 4 });
    await createTime({ projectId: project.id, date: '2026-11-11', hours: 2 });

    const detail = await call(
      'get',
      `/projects/${project.id}/profitability`,
      ownerToken,
      acmeId,
    ).expect(200);
    expect(detail.body.project.profitability).toMatchObject({
      revenue: 1000,
      expenses: 200,
      profit: 800,
      invoiceCount: 1,
      expenseCount: 1,
      timeEntryCount: 2,
      billableHours: 6,
      unbilledHours: 6,
      billableValue: 900,
      invoicedValue: 0,
      unbilledValue: 900,
    });
    expect(detail.body.expenses[0].number).toMatch(/^EXP-\d{4}$/);
    expect(detail.body.timeEntries).toHaveLength(2);

    const list = await call('get', '/projects?search=TEST PROJ Alpha', staffToken, acmeId).expect(
      200,
    );
    const row = (list.body.projects as ProjectView[]).find((item) => item.id === project.id)!;
    expect(row.profitability).toMatchObject({
      revenue: 1000,
      expenses: 200,
      profit: 800,
      unbilledValue: 900,
    });
  });

  it('rolls billable time into one draft invoice without posting, and blocks double billing', async () => {
    const project = await createProject({ defaultRate: 125 });
    const otherProject = await createProject({ name: 'TEST PROJ Other' });
    const first = await createTime({
      projectId: project.id,
      date: '2026-11-10',
      hours: 2,
      notes: 'TEST TIME first',
    });
    const second = await createTime({
      projectId: project.id,
      date: '2026-11-11',
      hours: 1.5,
      rate: 100,
      notes: 'TEST TIME second',
    });
    const nonBillable = await createTime({
      projectId: project.id,
      date: '2026-11-12',
      hours: 1,
      billable: false,
      notes: 'TEST TIME nonbillable',
    });
    const foreign = await createTime({
      projectId: otherProject.id,
      date: '2026-11-13',
      hours: 3,
      notes: 'TEST TIME other',
    });

    await call('post', '/time-entries/rollup', staffToken, acmeId)
      .send({ entryIds: [first.id, nonBillable.id], notes: 'TEST TIME ROLLUP bad' })
      .expect(400);
    await call('post', '/time-entries/rollup', staffToken, acmeId)
      .send({ entryIds: [first.id, foreign.id], notes: 'TEST TIME ROLLUP mixed' })
      .expect(400);

    const rollup = await call('post', '/time-entries/rollup', staffToken, acmeId)
      .send({
        entryIds: [first.id, second.id],
        issueDate: '2026-11-14',
        dueDate: '2026-12-14',
        taxRate: 0,
        notes: 'TEST TIME ROLLUP invoice',
      })
      .expect(201);

    const invoice = rollup.body.invoice as InvoiceView;
    expect(invoice.status).toBe('DRAFT');
    expect(invoice.projectId).toBe(project.id);
    expect(invoice.number).toMatch(/^INV-\d{4}$/);
    expect(invoice.subtotal).toBe(400);
    expect(invoice.lines).toHaveLength(2);
    expect(invoice.lines[0]).toMatchObject({
      quantity: 2,
      unitPrice: 125,
      amount: 250,
    });
    expect(invoice.lines[1]).toMatchObject({
      quantity: 1.5,
      unitPrice: 100,
      amount: 150,
    });
    expect(invoice.lines[0].timeEntry?.id).toBe(first.id);
    expect(invoice.lines[1].timeEntry?.id).toBe(second.id);

    const journals = await prisma.journalEntry.findMany({
      where: { organizationId: acmeId, sourceType: 'INVOICE', sourceId: invoice.id },
    });
    expect(journals).toHaveLength(0);

    const entries = await call('get', `/time-entries?projectId=${project.id}`, staffToken, acmeId)
      .expect(200);
    const linked = (entries.body.timeEntries as TimeEntryView[]).filter(
      (entry) => entry.invoice,
    );
    expect(linked).toHaveLength(2);
    expect(linked[0].invoice?.id).toBe(invoice.id);
    expect(linked[0].invoice?.status).toBe('DRAFT');

    const detail = await call('get', `/projects/${project.id}`, ownerToken, acmeId).expect(200);
    expect(detail.body.project.profitability).toMatchObject({
      revenue: 0,
      invoicedHours: 3.5,
      unbilledHours: 0,
      invoicedValue: 400,
      unbilledValue: 0,
    });

    await call('post', '/time-entries/rollup', staffToken, acmeId)
      .send({ entryIds: [first.id], notes: 'TEST TIME ROLLUP double' })
      .expect(400);

    await call('patch', `/time-entries/${first.id}`, staffToken, acmeId)
      .send({ hours: 4 })
      .expect(400);
    await call('delete', `/time-entries/${first.id}`, staffToken, acmeId).expect(400);

    await call('patch', `/invoices/${invoice.id}`, staffToken, acmeId)
      .send({ lines: [{ itemId, quantity: 1, unitPrice: 400 }] })
      .expect(400);
    const noteEdit = await call('patch', `/invoices/${invoice.id}`, staffToken, acmeId)
      .send({ notes: 'TEST TIME ROLLUP invoice edited' })
      .expect(200);
    expect((noteEdit.body as InvoiceView).lines[0].timeEntry?.id).toBe(first.id);

    const audit = await call(
      'get',
      '/audit-log?entityType=Invoice&limit=100',
      ownerToken,
      acmeId,
    ).expect(200);
    expect(
      (audit.body.entries as Array<{ action: string; entityId: string }>).some(
        (entry) => entry.action === 'time_entry.rollup' && entry.entityId === invoice.id,
      ),
    ).toBe(true);

    await call('post', '/time-entries/rollup', viewerToken, acmeId)
      .send({ entryIds: [nonBillable.id] })
      .expect(403);
  });

  it('rejects cross-tenant time entries and roll-up without a customer or item', async () => {
    const project = await createProject();
    const entry = await createTime({
      projectId: project.id,
      date: '2026-11-10',
      hours: 1,
      notes: 'TEST TIME isolation',
    });

    const nimbusProject = await createProject(
      {
        name: 'TEST PROJ Nimbus',
        customerId: nimbusCustomerId,
        billingItemId: nimbusItemId,
        defaultRate: 90,
      },
      nimbusOwnerToken,
      nimbusId,
    );
    const nimbusEntry = await createTime(
      { projectId: nimbusProject.id, hours: 2, notes: 'TEST TIME nimbus' },
      nimbusOwnerToken,
      nimbusId,
    );

    await call('post', '/time-entries/rollup', staffToken, acmeId)
      .send({ entryIds: [entry.id, nimbusEntry.id], notes: 'TEST TIME ROLLUP foreign' })
      .expect(404);

    const bare = await createProject({ name: 'TEST PROJ Bare', customerId: '', billingItemId: '' });
    const bareEntry = await createTime({
      projectId: bare.id,
      hours: 1,
      notes: 'TEST TIME bare',
    });
    await call('post', '/time-entries/rollup', staffToken, acmeId)
      .send({ entryIds: [bareEntry.id], notes: 'TEST TIME ROLLUP bare' })
      .expect(400);
  });
});
