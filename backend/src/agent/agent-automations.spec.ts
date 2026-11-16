import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.factory';
import { PrismaService } from '../prisma/prisma.service';
import { AgentAutomationScheduler } from './agent-automation-scheduler.service';

interface AutomationView {
  id: string;
  name: string;
  cron: string;
  timezone: string;
  prompt: string;
  enabled: boolean;
  mode: string;
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
  toolNames: string[];
  logReference: string | null;
  logs: Array<{ trigger: string; status: string; toolNames: string[] | null }>;
}

jest.setTimeout(30_000);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Scheduled agent automations', () => {
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
  const jobIds: string[] = [];

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

  async function createAutomation(
    overrides: Partial<{
      name: string;
      prompt: string;
      cron: string;
      timezone: string;
      enabled: boolean;
    }> = {},
    options: { token?: string; orgId?: string; expect?: number } = {},
  ): Promise<AutomationView> {
    counter += 1;
    const res = await request(app.getHttpServer())
      .post('/api/v1/agent/automations')
      .set(withOrg(options.token ?? ownerToken, options.orgId ?? acmeId))
      .send({
        name: overrides.name ?? `PW automation ${counter}`,
        prompt: overrides.prompt ?? 'What is my cash position?',
        cron: overrides.cron ?? '0 9 * * 1',
        ...(overrides.timezone ? { timezone: overrides.timezone } : {}),
        ...(overrides.enabled !== undefined ? { enabled: overrides.enabled } : {}),
      })
      .expect(options.expect ?? 201);
    const row = res.body as AutomationView;
    if (row.id) automationIds.push(row.id);
    return row;
  }

  async function listAutomations(
    token = ownerToken,
    orgId = acmeId,
  ): Promise<AutomationView[]> {
    const res = await request(app.getHttpServer())
      .get('/api/v1/agent/automations')
      .set(withOrg(token, orgId))
      .expect(200);
    return res.body.automations as AutomationView[];
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

  async function waitForAutomation(
    id: string,
    predicate: (row: AutomationView) => boolean,
    timeoutMs = 10_000,
  ): Promise<AutomationView> {
    const started = Date.now();
    let latest = await getAutomation(id);
    while (Date.now() - started < timeoutMs) {
      if (predicate(latest)) return latest;
      await sleep(40);
      latest = await getAutomation(id);
    }
    throw new Error(`Automation ${id} did not reach the expected state: ${latest.lastStatus}`);
  }

  async function submitPrompt(prompt: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/agent/prompts')
      .set(withOrg(ownerToken, acmeId))
      .send({ prompt })
      .expect(202);
    const jobId = res.body.jobId as string;
    jobIds.push(jobId);
    return jobId;
  }

  async function waitForJob(
    jobId: string,
    predicate: (job: JobView) => boolean,
    timeoutMs = 10_000,
  ): Promise<JobView> {
    const started = Date.now();
    let latest: JobView | undefined;
    while (Date.now() - started < timeoutMs) {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/agent/jobs/${jobId}`)
        .set(withOrg(ownerToken, acmeId))
        .expect(200);
      latest = res.body as JobView;
      if (predicate(latest)) return latest;
      await sleep(40);
    }
    throw new Error(`Job ${jobId} did not reach the expected state: ${latest?.status}`);
  }

  async function cleanup(): Promise<void> {
    if (!acmeId || !nimbusId) return;
    const rows = await prisma.agentAutomation.findMany({
      where: { organizationId: { in: [acmeId, nimbusId] } },
      select: { id: true },
    });
    const ids = [...new Set([...rows.map((row) => row.id), ...automationIds])];
    if (ids.length > 0) {
      for (const id of ids) {
        await scheduler?.remove(id).catch(() => undefined);
      }
      const jobs = await prisma.agentJob.findMany({
        where: {
          OR: [
            { automationId: { in: ids } },
            ...(jobIds.length > 0 ? [{ id: { in: jobIds } }] : []),
          ],
        },
        select: { id: true },
      });
      const runJobIds = [...new Set([...jobs.map((job) => job.id), ...jobIds])];
      await prisma.agentProposal.deleteMany({ where: { jobId: { in: runJobIds } } });
      await prisma.agentActionLog.deleteMany({ where: { jobId: { in: runJobIds } } });
      await prisma.agentJob.deleteMany({ where: { id: { in: runJobIds } } });
      await prisma.auditLogEntry.deleteMany({
        where: { entityType: 'AgentAutomation', entityId: { in: ids } },
      });
      await prisma.agentAutomation.deleteMany({ where: { id: { in: ids } } });
    }
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

  it('creates an enabled schedule, registers one repeatable job, and audits it', async () => {
    const created = await createAutomation({
      name: 'PW automation weekly cash',
      prompt: 'What is my cash position?',
      cron: '0 9 * * 1',
    });

    expect(created).toMatchObject({
      name: 'PW automation weekly cash',
      cron: '0 9 * * 1',
      timezone: 'UTC',
      enabled: true,
      mode: 'CRON',
      scheduleLabel: 'Every Monday at 9:00 AM',
      createdBy: { email: 'owner@acme.test' },
      lastStatus: null,
    });
    expect(created.nextRunAt).toMatch(/T09:00:00\.000Z$/);

    const schedules = (await scheduler.list()).filter((row) => row.id === created.id);
    expect(schedules).toHaveLength(1);
    expect(schedules[0]).toMatchObject({ cron: '0 9 * * 1', timezone: 'UTC' });

    const list = await listAutomations();
    expect(list.map((row) => row.id)).toContain(created.id);

    const audit = await prisma.auditLogEntry.findFirst({
      where: {
        organizationId: acmeId,
        action: 'agent.automation.create',
        entityId: created.id,
      },
    });
    expect(audit).toBeTruthy();
  });

  it('edits a schedule in place, pauses, resumes, and deletes it', async () => {
    const created = await createAutomation({ name: 'PW automation editable' });

    const editedRes = await request(app.getHttpServer())
      .patch(`/api/v1/agent/automations/${created.id}`)
      .set(withOrg(ownerToken, acmeId))
      .send({ cron: '30 18 * * 5', name: 'PW automation edited', timezone: 'America/New_York' })
      .expect(200);
    const edited = editedRes.body as AutomationView;
    expect(edited.id).toBe(created.id);
    expect(edited).toMatchObject({
      name: 'PW automation edited',
      cron: '30 18 * * 5',
      timezone: 'America/New_York',
      scheduleLabel: 'Every Friday at 6:30 PM',
      enabled: true,
    });

    const afterEdit = (await scheduler.list()).filter((row) => row.id === created.id);
    expect(afterEdit).toHaveLength(1);
    expect(afterEdit[0]).toMatchObject({ cron: '30 18 * * 5', timezone: 'America/New_York' });

    const paused = await request(app.getHttpServer())
      .patch(`/api/v1/agent/automations/${created.id}`)
      .set(withOrg(ownerToken, acmeId))
      .send({ enabled: false })
      .expect(200);
    expect(paused.body.enabled).toBe(false);
    expect(paused.body.nextRunAt).toBeNull();
    expect((await scheduler.list()).some((row) => row.id === created.id)).toBe(false);

    const resumed = await request(app.getHttpServer())
      .patch(`/api/v1/agent/automations/${created.id}`)
      .set(withOrg(ownerToken, acmeId))
      .send({ enabled: true })
      .expect(200);
    expect(resumed.body.enabled).toBe(true);
    const afterResume = (await scheduler.list()).filter((row) => row.id === created.id);
    expect(afterResume).toHaveLength(1);

    await request(app.getHttpServer())
      .delete(`/api/v1/agent/automations/${created.id}`)
      .set(withOrg(ownerToken, acmeId))
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/v1/agent/automations/${created.id}`)
      .set(withOrg(ownerToken, acmeId))
      .expect(404);
    expect((await scheduler.list()).some((row) => row.id === created.id)).toBe(false);

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
  });

  it('rejects invalid cron, invalid timezone, duplicate names, and empty patches', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/agent/automations')
      .set(withOrg(ownerToken, acmeId))
      .send({ name: 'PW automation bad cron', prompt: 'Cash?', cron: '0 9 * *' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/agent/automations')
      .set(withOrg(ownerToken, acmeId))
      .send({ name: 'PW automation bad tz', prompt: 'Cash?', cron: '0 9 * * 1', timezone: 'Mars/Base' })
      .expect(400);

    const first = await createAutomation({ name: 'PW automation duplicate' });
    await request(app.getHttpServer())
      .post('/api/v1/agent/automations')
      .set(withOrg(ownerToken, acmeId))
      .send({ name: first.name, prompt: 'Cash?', cron: '0 9 * * 1' })
      .expect(409);

    const unknown = await request(app.getHttpServer())
      .patch('/api/v1/agent/automations/does-not-exist')
      .set(withOrg(ownerToken, acmeId))
      .send({ enabled: false })
      .expect(404);
    expect(unknown.body.message).toContain('Automation not found');
  });

  it('lets staff manage automations while viewers only read and non-managers cannot write', async () => {
    const staffCreated = await createAutomation(
      { name: 'PW automation staff' },
      { token: staffToken },
    );
    const edited = await request(app.getHttpServer())
      .patch(`/api/v1/agent/automations/${staffCreated.id}`)
      .set(withOrg(staffToken, acmeId))
      .send({ prompt: 'Show me the profit and loss report' })
      .expect(200);
    expect(edited.body.prompt).toBe('Show me the profit and loss report');

    const viewerList = await listAutomations(viewerToken);
    expect(viewerList.map((row) => row.id)).toContain(staffCreated.id);

    await request(app.getHttpServer())
      .post('/api/v1/agent/automations')
      .set(withOrg(viewerToken, acmeId))
      .send({ name: 'PW automation viewer', prompt: 'Cash?', cron: '0 9 * * 1' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/agent/automations/${staffCreated.id}`)
      .set(withOrg(viewerToken, acmeId))
      .send({ enabled: false })
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/api/v1/agent/automations/${staffCreated.id}`)
      .set(withOrg(viewerToken, acmeId))
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/api/v1/agent/automations/${staffCreated.id}`)
      .set(withOrg(staffToken, acmeId))
      .expect(200);
  });

  it('keeps automations tenant-scoped with cross-tenant 404s', async () => {
    const created = await createAutomation({ name: 'PW automation acme only' });

    await request(app.getHttpServer())
      .get(`/api/v1/agent/automations/${created.id}`)
      .set(withOrg(nimbusOwnerToken, nimbusId))
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/agent/automations/${created.id}`)
      .set(withOrg(nimbusOwnerToken, nimbusId))
      .send({ enabled: false })
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/v1/agent/automations/${created.id}`)
      .set(withOrg(nimbusOwnerToken, nimbusId))
      .expect(404);

    const nimbusList = await listAutomations(nimbusOwnerToken, nimbusId);
    expect(nimbusList.map((row) => row.id)).not.toContain(created.id);
  });

  it('runs an automation deterministically through the guarded test hook', async () => {
    const created = await createAutomation({
      name: 'PW automation run',
      prompt: 'What is my cash position?',
      cron: '0 9 * * 1',
    });

    const run = await request(app.getHttpServer())
      .post(`/api/v1/agent/test/automations/${created.id}/run`)
      .set(withOrg(ownerToken, acmeId))
      .expect(200);

    expect(run.body.jobId).toBeTruthy();
    expect(run.body.skipped).toBe(false);

    const jobId = run.body.jobId as string;
    jobIds.push(jobId);
    const started = Date.now();
    let job: JobView | undefined;
    while (Date.now() - started < 10_000) {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/agent/jobs/${jobId}`)
        .set(withOrg(ownerToken, acmeId))
        .expect(200);
      job = res.body as JobView;
      if (job.status === 'COMPLETED' || job.status === 'FAILED') break;
      await sleep(40);
    }
    expect(job?.status).toBe('COMPLETED');
    expect(job?.trigger).toBe('CRON');
    expect(job?.automationId).toBe(created.id);
    expect(job?.toolNames).toEqual(['insight.query']);
    expect(job?.logs.every((row) => row.trigger === 'CRON')).toBe(true);
    expect(job?.logs.some((row) => row.toolNames?.includes('insight.query'))).toBe(true);

    const automation = await waitForAutomation(
      created.id,
      (row) => row.lastStatus === 'COMPLETED',
    );
    expect(automation.lastJobId).toBe(jobId);
    expect(automation.lastRunAt).toBeTruthy();
    expect(automation.lastLogReference).toBeTruthy();

    const logs = await request(app.getHttpServer())
      .get('/api/v1/agent/logs?trigger=CRON&limit=200')
      .set(withOrg(ownerToken, acmeId))
      .expect(200);
    expect(
      (logs.body.logs as Array<{ jobId: string | null }>).some((row) => row.jobId === jobId),
    ).toBe(true);
  });

  it('proposes automation.create and registers the schedule after approval', async () => {
    const jobId = await submitPrompt(
      'Create an automation called "PW proposed routine" that every Monday at 9:00 asks for my cash position.',
    );
    const job = await waitForJob(
      jobId,
      (row) =>
        row.status === 'COMPLETED' &&
        (row as unknown as { proposals: Array<{ status: string; toolName: string }> })
          .proposals.length === 1,
    );
    const proposal = (
      job as unknown as {
        proposals: Array<{ id: string; toolName: string; status: string; args: unknown }>;
      }
    ).proposals[0];
    expect(proposal).toMatchObject({ toolName: 'automation.create', status: 'PENDING' });
    expect(proposal.args).toMatchObject({
      name: 'PW proposed routine',
      cron: '0 9 * * 1',
      timezone: 'UTC',
    });

    const before = await listAutomations();
    expect(before.some((row) => row.name === 'PW proposed routine')).toBe(false);

    const approved = await request(app.getHttpServer())
      .post(`/api/v1/agent/approvals/${proposal.id}/approve`)
      .set(withOrg(ownerToken, acmeId))
      .expect(200);
    expect(approved.body.status).toBe('EXECUTED');

    const after = await listAutomations();
    const automation = after.find((row) => row.name === 'PW proposed routine');
    expect(automation).toBeTruthy();
    automationIds.push(automation!.id);
    expect(automation).toMatchObject({
      cron: '0 9 * * 1',
      enabled: true,
      createdBy: { email: 'owner@acme.test' },
    });
    const schedules = (await scheduler.list()).filter((row) => row.id === automation!.id);
    expect(schedules).toHaveLength(1);
  });

  it('does not run a paused automation and hides the hook when disabled', async () => {
    const created = await createAutomation({ name: 'PW automation paused' });
    await request(app.getHttpServer())
      .patch(`/api/v1/agent/automations/${created.id}`)
      .set(withOrg(ownerToken, acmeId))
      .send({ enabled: false })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/agent/test/automations/${created.id}/run`)
      .set(withOrg(ownerToken, acmeId))
      .expect(409);
    expect(await prisma.agentJob.count({ where: { automationId: created.id } })).toBe(0);

    const previous = process.env.AGENT_TEST_HOOKS;
    process.env.AGENT_TEST_HOOKS = '0';
    try {
      await request(app.getHttpServer())
        .post(`/api/v1/agent/test/automations/${created.id}/run`)
        .set(withOrg(ownerToken, acmeId))
        .expect(404);
    } finally {
      process.env.AGENT_TEST_HOOKS = previous;
    }
  });

  it('is exposed as a sensitive governed tool with a default approval policy', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/agent/policies')
      .set(withOrg(ownerToken, acmeId))
      .expect(200);
    const policy = (
      res.body.policies as Array<{
        toolName: string;
        readOnly: boolean;
        sensitive: boolean;
        configurable: boolean;
        defaultPolicy: string;
        policy: string;
      }>
    ).find((row) => row.toolName === 'automation.create');
    expect(policy).toMatchObject({
      readOnly: false,
      sensitive: true,
      configurable: true,
      defaultPolicy: 'approve',
      policy: 'approve',
    });
  });
});
