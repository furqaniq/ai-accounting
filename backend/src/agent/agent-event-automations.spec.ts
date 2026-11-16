import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AgentDomainEventType } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.factory';
import { PrismaService } from '../prisma/prisma.service';
import { AgentAutomationScheduler } from './agent-automation-scheduler.service';

interface AutomationView {
  id: string;
  name: string;
  mode: string;
  cron: string | null;
  timezone: string;
  eventType: string | null;
  eventConfig: Record<string, number> | null;
  prompt: string;
  enabled: boolean;
  scheduleLabel: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastJobId: string | null;
  lastLogReference: string | null;
  createdBy: { email: string } | null;
}

interface JobView {
  jobId: string;
  status: string;
  trigger: string;
  automationId: string | null;
  prompt: string;
  toolNames: string[];
  logs: Array<{ trigger: string; status: string; toolNames: string[] | null }>;
}

jest.setTimeout(30_000);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Event agent automations', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let scheduler: AgentAutomationScheduler;
  let ownerToken: string;
  let staffToken: string;
  let viewerToken: string;
  let nimbusOwnerToken: string;
  let acmeId: string;
  let nimbusId: string;
  let counter = 0;
  const automationIds: string[] = [];

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'Passw0rd!2026' })
      .expect(200);
    return res.body.accessToken as string;
  }

  function withOrg(token: string, orgId: string) {
    return { Authorization: `Bearer ${token}`, 'X-Organization-Id': orgId };
  }

  async function createEventAutomation(
    overrides: Partial<{
      name: string;
      prompt: string;
      eventType: AgentDomainEventType;
      eventConfig: Record<string, number>;
      enabled: boolean;
    }> = {},
    options: { token?: string; orgId?: string; expect?: number } = {},
  ): Promise<AutomationView> {
    counter += 1;
    const res = await request(app.getHttpServer())
      .post('/api/v1/agent/automations')
      .set(withOrg(options.token ?? ownerToken, options.orgId ?? acmeId))
      .send({
        name: overrides.name ?? `PW event ${counter}`,
        prompt: overrides.prompt ?? 'What is my cash position?',
        mode: 'EVENT',
        eventType: overrides.eventType ?? 'BANK_TRANSACTION_IMPORTED',
        eventConfig: overrides.eventConfig ?? {},
        ...(overrides.enabled !== undefined ? { enabled: overrides.enabled } : {}),
      })
      .expect(options.expect ?? 201);
    const row = res.body as AutomationView;
    if (row.id) automationIds.push(row.id);
    return row;
  }

  async function getAutomation(
    id: string,
    token = ownerToken,
    orgId = acmeId,
  ): Promise<AutomationView> {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/agent/automations/${id}`)
      .set(withOrg(token, orgId))
      .expect(200);
    return res.body as AutomationView;
  }

  async function fireEvent(
    type: AgentDomainEventType,
    data: Record<string, unknown> = {},
    options: { token?: string; orgId?: string; entityId?: string; expect?: number } = {},
  ) {
    return request(app.getHttpServer())
      .post('/api/v1/agent/test/events')
      .set(withOrg(options.token ?? ownerToken, options.orgId ?? acmeId))
      .send({
        type,
        ...(options.entityId ? { entityId: options.entityId } : {}),
        data,
      })
      .expect(options.expect ?? 200);
  }

  async function jobsFor(automationId: string) {
    return prisma.agentJob.findMany({
      where: { automationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async function waitForCompletedJob(
    automationId: string,
    timeoutMs = 10_000,
  ): Promise<JobView> {
    const started = Date.now();
    let jobId: string | undefined;
    while (Date.now() - started < timeoutMs) {
      const rows = await jobsFor(automationId);
      const job = rows[rows.length - 1];
      if (job && (job.status === 'COMPLETED' || job.status === 'FAILED')) {
        jobId = job.id;
        break;
      }
      await sleep(40);
    }
    if (!jobId) throw new Error('Event automation did not create a finished job');
    const res = await request(app.getHttpServer())
      .get(`/api/v1/agent/jobs/${jobId}`)
      .set(withOrg(ownerToken, acmeId))
      .expect(200);
    return res.body as JobView;
  }

  async function cleanup(): Promise<void> {
    if (!acmeId || !nimbusId) return;
    const rows = await prisma.agentAutomation.findMany({
      where: {
        organizationId: { in: [acmeId, nimbusId] },
        name: { startsWith: 'PW event ' },
      },
      select: { id: true },
    });
    const ids = [...new Set([...rows.map((row) => row.id), ...automationIds])];
    if (ids.length === 0) return;
    for (const id of ids) {
      await scheduler?.remove(id).catch(() => undefined);
    }
    const jobs = await prisma.agentJob.findMany({
      where: { automationId: { in: ids } },
      select: { id: true },
    });
    const jobIds = jobs.map((job) => job.id);
    await prisma.agentProposal.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.agentActionLog.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.agentJob.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.auditLogEntry.deleteMany({
      where: { entityType: 'AgentAutomation', entityId: { in: ids } },
    });
    await prisma.agentAutomation.deleteMany({ where: { id: { in: ids } } });
    automationIds.length = 0;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    scheduler = app.get(AgentAutomationScheduler);

    ownerToken = await login('owner@acme.test');
    staffToken = await login('staff@acme.test');
    viewerToken = await login('viewer@acme.test');
    nimbusOwnerToken = await login('owner@nimbus.test');
    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const memberships = me.body.memberships as Array<{
      organizationId: string;
      organizationName: string;
    }>;
    acmeId = memberships.find((m) => m.organizationName === 'Acme Services Co.')!.organizationId;
    nimbusId = memberships.find((m) => m.organizationName === 'Nimbus Retail LLC')!.organizationId;
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  it('creates, edits, pauses, resumes, and deletes an event automation with audits', async () => {
    const created = await createEventAutomation({
      name: 'PW event bills over 500',
      eventType: AgentDomainEventType.BILL_OPENED,
      eventConfig: { minAmount: 500 },
    });

    expect(created).toMatchObject({
      mode: 'EVENT',
      cron: null,
      eventType: 'BILL_OPENED',
      eventConfig: { minAmount: 500 },
      scheduleLabel: 'When a bill opens above $500.00',
      enabled: true,
      nextRunAt: null,
      createdBy: { email: 'owner@acme.test' },
    });
    expect((await scheduler.list()).some((row) => row.id === created.id)).toBe(false);

    const edited = await request(app.getHttpServer())
      .patch(`/api/v1/agent/automations/${created.id}`)
      .set(withOrg(ownerToken, acmeId))
      .send({ eventConfig: { minAmount: 100 }, prompt: 'Review large bills.' })
      .expect(200);
    expect(edited.body).toMatchObject({
      mode: 'EVENT',
      eventConfig: { minAmount: 100 },
      scheduleLabel: 'When a bill opens above $100.00',
    });

    const paused = await request(app.getHttpServer())
      .patch(`/api/v1/agent/automations/${created.id}`)
      .set(withOrg(ownerToken, acmeId))
      .send({ enabled: false })
      .expect(200);
    expect(paused.body.enabled).toBe(false);

    const resumed = await request(app.getHttpServer())
      .patch(`/api/v1/agent/automations/${created.id}`)
      .set(withOrg(ownerToken, acmeId))
      .send({ enabled: true })
      .expect(200);
    expect(resumed.body.enabled).toBe(true);

    await request(app.getHttpServer())
      .delete(`/api/v1/agent/automations/${created.id}`)
      .set(withOrg(ownerToken, acmeId))
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/agent/automations/${created.id}`)
      .set(withOrg(ownerToken, acmeId))
      .expect(404);

    const actions = (
      await prisma.auditLogEntry.findMany({
        where: { organizationId: acmeId, entityType: 'AgentAutomation', entityId: created.id },
      })
    ).map((row) => row.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'agent.automation.create',
        'agent.automation.update',
        'agent.automation.pause',
        'agent.automation.resume',
        'agent.automation.delete',
      ]),
    );
    const createAudit = await prisma.auditLogEntry.findFirst({
      where: {
        organizationId: acmeId,
        action: 'agent.automation.create',
        entityId: created.id,
      },
    });
    expect(createAudit?.metadata).toMatchObject({
      mode: 'EVENT',
      eventType: 'BILL_OPENED',
    });
  });

  it('validates event definitions and keeps cron/event triggers separate', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/agent/automations')
      .set(withOrg(ownerToken, acmeId))
      .send({ name: 'PW event missing type', prompt: 'Review', mode: 'EVENT' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/agent/automations')
      .set(withOrg(ownerToken, acmeId))
      .send({ name: 'PW event cron missing', prompt: 'Review', mode: 'CRON' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/agent/automations')
      .set(withOrg(ownerToken, acmeId))
      .send({
        name: 'PW event negative',
        prompt: 'Review',
        mode: 'EVENT',
        eventType: 'BILL_OPENED',
        eventConfig: { minAmount: -1 },
      })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/agent/automations')
      .set(withOrg(ownerToken, acmeId))
      .send({
        name: 'PW event foreign config',
        prompt: 'Review',
        mode: 'EVENT',
        eventType: 'BILL_OPENED',
        eventConfig: { daysOverdue: 3 },
      })
      .expect(400);

    const event = await createEventAutomation({ name: 'PW event immutable type' });
    await request(app.getHttpServer())
      .patch(`/api/v1/agent/automations/${event.id}`)
      .set(withOrg(ownerToken, acmeId))
      .send({ cron: '0 9 * * 1' })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/v1/agent/automations/${event.id}`)
      .set(withOrg(ownerToken, acmeId))
      .send({ mode: 'CRON' })
      .expect(400);

    const cronRes = await request(app.getHttpServer())
      .post('/api/v1/agent/automations')
      .set(withOrg(ownerToken, acmeId))
      .send({
        name: 'PW event cron stays cron',
        prompt: 'Cash?',
        cron: '0 9 * * 1',
      })
      .expect(201);
    automationIds.push(cronRes.body.id);
    expect(cronRes.body).toMatchObject({ mode: 'CRON', eventType: null, eventConfig: null });
    await request(app.getHttpServer())
      .patch(`/api/v1/agent/automations/${cronRes.body.id}`)
      .set(withOrg(ownerToken, acmeId))
      .send({ eventType: 'BILL_OPENED' })
      .expect(400);
  });

  it('enforces staff manage, viewer read-only, and tenant isolation', async () => {
    const staffCreated = await createEventAutomation(
      { name: 'PW event staff managed' },
      { token: staffToken },
    );
    const viewerList = await request(app.getHttpServer())
      .get('/api/v1/agent/automations')
      .set(withOrg(viewerToken, acmeId))
      .expect(200);
    expect(
      (viewerList.body.automations as AutomationView[]).some((row) => row.id === staffCreated.id),
    ).toBe(true);

    await request(app.getHttpServer())
      .post('/api/v1/agent/automations')
      .set(withOrg(viewerToken, acmeId))
      .send({
        name: 'PW event viewer',
        prompt: 'Review',
        mode: 'EVENT',
        eventType: 'BILL_OPENED',
      })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/agent/automations/${staffCreated.id}`)
      .set(withOrg(viewerToken, acmeId))
      .send({ enabled: false })
      .expect(403);

    await request(app.getHttpServer())
      .get(`/api/v1/agent/automations/${staffCreated.id}`)
      .set(withOrg(nimbusOwnerToken, nimbusId))
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/agent/automations/${staffCreated.id}`)
      .set(withOrg(nimbusOwnerToken, nimbusId))
      .send({ enabled: false })
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/v1/agent/automations/${staffCreated.id}`)
      .set(withOrg(nimbusOwnerToken, nimbusId))
      .expect(404);

    await fireEvent(
      AgentDomainEventType.BANK_TRANSACTION_IMPORTED,
      { description: 'Foreign', amount: 10 },
      { token: nimbusOwnerToken, orgId: nimbusId },
    );
    expect(await jobsFor(staffCreated.id)).toHaveLength(0);
  });

  it('fires a matching bank event through the EVENT job/log path', async () => {
    const created = await createEventAutomation({
      name: 'PW event bank import',
      prompt: 'What is my cash position?',
    });

    const fired = await fireEvent(AgentDomainEventType.BANK_TRANSACTION_IMPORTED, {
      description: 'INVOICE PAYMENT NORTHWIND',
      date: '2026-11-16',
      amount: 1200,
      bankAccountName: 'Operating checking',
    });
    expect(fired.body).toMatchObject({
      published: true,
      type: 'BANK_TRANSACTION_IMPORTED',
      entityType: 'BankTransaction',
    });

    const job = await waitForCompletedJob(created.id);
    expect(job).toMatchObject({
      status: 'COMPLETED',
      trigger: 'EVENT',
      automationId: created.id,
      toolNames: ['insight.query'],
    });
    expect(job.prompt).toContain('What is my cash position?');
    expect(job.prompt).toContain('[Bank transaction imported]');
    expect(job.prompt).toContain('INVOICE PAYMENT NORTHWIND');
    expect(job.logs.every((row) => row.trigger === 'EVENT')).toBe(true);

    const started = Date.now();
    let automation = await getAutomation(created.id);
    while (
      Date.now() - started < 5_000 &&
      automation.lastStatus !== 'COMPLETED'
    ) {
      await sleep(40);
      automation = await getAutomation(created.id);
    }
    expect(automation).toMatchObject({
      lastStatus: 'COMPLETED',
      lastJobId: job.jobId,
    });
    expect(automation.lastRunAt).toBeTruthy();
    expect(automation.lastLogReference).toBeTruthy();

    const logs = await request(app.getHttpServer())
      .get('/api/v1/agent/logs?trigger=EVENT&limit=200')
      .set(withOrg(ownerToken, acmeId))
      .expect(200);
    expect(
      (logs.body.logs as Array<{ jobId: string | null }>).some((row) => row.jobId === job.jobId),
    ).toBe(true);
  });

  it('applies invoice day thresholds and ignores unrelated events', async () => {
    const created = await createEventAutomation({
      name: 'PW event overdue 5 days',
      eventType: AgentDomainEventType.INVOICE_OVERDUE,
      eventConfig: { daysOverdue: 5 },
    });

    await fireEvent(AgentDomainEventType.BANK_TRANSACTION_IMPORTED, {
      description: 'Unrelated',
      amount: 1,
    });
    await fireEvent(AgentDomainEventType.INVOICE_OVERDUE, {
      number: 'INV-TEST',
      daysOverdue: 4,
      balanceDue: 100,
    });
    await sleep(150);
    expect(await jobsFor(created.id)).toHaveLength(0);

    await fireEvent(AgentDomainEventType.INVOICE_OVERDUE, {
      number: 'INV-TEST',
      customerName: 'Northwind Studio',
      dueDate: '2026-11-01',
      daysOverdue: 6,
      balanceDue: 100,
    });
    const job = await waitForCompletedJob(created.id);
    expect(job.trigger).toBe('EVENT');
    expect(job.prompt).toContain('6 days overdue');
  });

  it('applies bill amount thresholds and reconciliation difference thresholds', async () => {
    const bill = await createEventAutomation({
      name: 'PW event bills over 250',
      eventType: AgentDomainEventType.BILL_OPENED,
      eventConfig: { minAmount: 250 },
    });
    await fireEvent(AgentDomainEventType.BILL_OPENED, {
      number: 'BILL-TEST',
      vendorName: 'Cedar Supply',
      total: 200,
      dueDate: '2026-12-01',
    });
    await sleep(150);
    expect(await jobsFor(bill.id)).toHaveLength(0);
    await fireEvent(AgentDomainEventType.BILL_OPENED, {
      number: 'BILL-TEST',
      vendorName: 'Cedar Supply',
      total: 250,
      dueDate: '2026-12-01',
    });
    const billJob = await waitForCompletedJob(bill.id);
    expect(billJob.prompt).toContain('[Bill opened]');
    expect(billJob.prompt).toContain('$250.00');

    const recon = await createEventAutomation({
      name: 'PW event reconciliation over 10',
      eventType: AgentDomainEventType.RECONCILIATION_DISCREPANCY,
      eventConfig: { minDifference: 10 },
    });
    await fireEvent(AgentDomainEventType.RECONCILIATION_DISCREPANCY, {
      bankAccountName: 'Operating checking',
      periodStart: '2026-11-01',
      periodEnd: '2026-11-30',
      difference: 9.5,
    });
    await sleep(150);
    expect(await jobsFor(recon.id)).toHaveLength(0);
    await fireEvent(AgentDomainEventType.RECONCILIATION_DISCREPANCY, {
      bankAccountName: 'Operating checking',
      periodStart: '2026-11-01',
      periodEnd: '2026-11-30',
      difference: -12,
    });
    const reconJob = await waitForCompletedJob(recon.id);
    expect(reconJob.prompt).toContain('$12.00');
  });

  it('does not fire paused automations and hides the event hook when disabled', async () => {
    const created = await createEventAutomation({
      name: 'PW event paused',
      enabled: false,
    });
    await fireEvent(AgentDomainEventType.BANK_TRANSACTION_IMPORTED, {
      description: 'Paused',
      amount: 5,
    });
    await sleep(150);
    expect(await jobsFor(created.id)).toHaveLength(0);

    const previous = process.env.AGENT_TEST_HOOKS;
    process.env.AGENT_TEST_HOOKS = '0';
    try {
      await fireEvent(
        AgentDomainEventType.BANK_TRANSACTION_IMPORTED,
        { description: 'Disabled' },
        { expect: 404 },
      );
    } finally {
      process.env.AGENT_TEST_HOOKS = previous;
    }
  });
});
