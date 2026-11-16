import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.factory';
import { PrismaService } from '../prisma/prisma.service';

interface PolicyView {
  id: string | null;
  toolName: string;
  permission: string;
  readOnly: boolean;
  sensitive: boolean;
  configurable: boolean;
  defaultPolicy: 'auto' | 'approve';
  policy: 'auto' | 'approve';
  updatedAt: string | null;
  updatedBy: { id: string; name: string; email: string } | null;
}

interface ProposalRow {
  id: string;
  toolName: string;
  status: string;
}

interface JobBody {
  jobId: string;
  status: string;
  response: string | null;
  toolNames: string[];
  proposals: ProposalRow[];
  logs: Array<{
    status: string;
    toolNames: string[] | null;
    output: unknown;
    approvalStatus: string | null;
  }>;
}

jest.setTimeout(20_000);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const PROMPT =
  'Create a draft invoice for Northwind Studio for 1 Consulting hour at $150, due in 30 days.';

describe('Agent approval policy', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let staffToken: string;
  let accountantToken: string;
  let viewerToken: string;
  let nimbusOwnerToken: string;
  let acmeId: string;
  let nimbusId: string;
  const createdJobIds: string[] = [];
  const createdInvoiceIds: string[] = [];
  const policyIds: string[] = [];

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

  async function policies(token = ownerToken, orgId = acmeId): Promise<PolicyView[]> {
    const res = await request(app.getHttpServer())
      .get('/api/v1/agent/policies')
      .set(withOrg(token, orgId))
      .expect(200);
    return res.body.policies as PolicyView[];
  }

  async function setPolicy(
    toolName: string,
    policy: 'auto' | 'approve',
    token = ownerToken,
    orgId = acmeId,
  ): Promise<PolicyView> {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/agent/policies/${toolName}`)
      .set(withOrg(token, orgId))
      .send({ policy })
      .expect(200);
    policyIds.push(res.body.id as string);
    return res.body as PolicyView;
  }

  async function submit(
    prompt: string,
    options: { token?: string; orgId?: string } = {},
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/agent/prompts')
      .set(withOrg(options.token ?? ownerToken, options.orgId ?? acmeId))
      .send({ prompt })
      .expect(202);
    createdJobIds.push(res.body.jobId as string);
    return res.body.jobId as string;
  }

  async function waitForJob(
    jobId: string,
    token: string,
    orgId: string,
    predicate: (job: JobBody) => boolean,
    timeoutMs = 10_000,
  ): Promise<JobBody> {
    const started = Date.now();
    let latest: JobBody | undefined;
    while (Date.now() - started < timeoutMs) {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/agent/jobs/${jobId}`)
        .set(withOrg(token, orgId))
        .expect(200);
      latest = res.body as JobBody;
      if (predicate(latest)) return latest;
      await sleep(40);
    }
    throw new Error(`Job ${jobId} did not reach the expected state: ${latest?.status}`);
  }

  async function invoiceCount(orgId = acmeId): Promise<number> {
    return prisma.invoice.count({ where: { organizationId: orgId } });
  }

  async function resetPolicies(): Promise<void> {
    if (!acmeId || !nimbusId) return;
    await prisma.agentToolPolicy.deleteMany({
      where: { organizationId: { in: [acmeId, nimbusId] } },
    });
    await prisma.auditLogEntry.deleteMany({
      where: {
        organizationId: { in: [acmeId, nimbusId] },
        entityType: 'AgentToolPolicy',
      },
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);

    ownerToken = await login('owner@acme.test');
    staffToken = await login('staff@acme.test');
    accountantToken = await login('accountant@acme.test');
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
    await resetPolicies();
  });

  afterAll(async () => {
    if (createdInvoiceIds.length > 0) {
      await prisma.auditLogEntry.deleteMany({
        where: {
          organizationId: { in: [acmeId, nimbusId] },
          entityType: 'Invoice',
          entityId: { in: createdInvoiceIds },
        },
      });
      await prisma.invoiceLine.deleteMany({
        where: { invoiceId: { in: createdInvoiceIds } },
      });
      await prisma.invoice.deleteMany({ where: { id: { in: createdInvoiceIds } } });
    }
    if (createdJobIds.length > 0) {
      await prisma.agentProposal.deleteMany({ where: { jobId: { in: createdJobIds } } });
      await prisma.agentActionLog.deleteMany({ where: { jobId: { in: createdJobIds } } });
      await prisma.agentJob.deleteMany({ where: { id: { in: createdJobIds } } });
    }
    await resetPolicies();
    await app.close();
  });

  it('lists every registered tool with a sensitive default for writes', async () => {
    const acme = await policies();
    const invoice = acme.find((row) => row.toolName === 'invoice.create')!;
    expect(invoice).toMatchObject({
      readOnly: false,
      sensitive: true,
      configurable: true,
      defaultPolicy: 'approve',
      policy: 'approve',
      updatedAt: null,
    });

    for (const toolName of ['insight.query', 'report.generate']) {
      expect(acme.find((row) => row.toolName === toolName)).toMatchObject({
        readOnly: true,
        sensitive: false,
        configurable: false,
        defaultPolicy: 'auto',
        policy: 'auto',
      });
    }

    const nimbus = await policies(nimbusOwnerToken, nimbusId);
    expect(nimbus.find((row) => row.toolName === 'invoice.create')!.policy).toBe(
      'approve',
    );
  });

  it('lets only Owners and Admins read or change a policy', async () => {
    for (const token of [staffToken, accountantToken, viewerToken]) {
      await request(app.getHttpServer())
        .get('/api/v1/agent/policies')
        .set(withOrg(token, acmeId))
        .expect(403);
      await request(app.getHttpServer())
        .patch('/api/v1/agent/policies/invoice.create')
        .set(withOrg(token, acmeId))
        .send({ policy: 'auto' })
        .expect(403);
    }
  });

  it('rejects unknown, read-only, and invalid policy updates', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/agent/policies/does.not.exist')
      .set(withOrg(ownerToken, acmeId))
      .send({ policy: 'auto' })
      .expect(404);
    await request(app.getHttpServer())
      .patch('/api/v1/agent/policies/insight.query')
      .set(withOrg(ownerToken, acmeId))
      .send({ policy: 'auto' })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/api/v1/agent/policies/invoice.create')
      .set(withOrg(ownerToken, acmeId))
      .send({ policy: 'sometimes' })
      .expect(400);
  });

  it('auto-executes a write at run time and switches back to proposals without a restart', async () => {
    const updated = await setPolicy('invoice.create', 'auto');
    expect(updated).toMatchObject({
      toolName: 'invoice.create',
      policy: 'auto',
      defaultPolicy: 'approve',
      updatedBy: { email: 'owner@acme.test' },
    });

    const before = await invoiceCount();
    const autoJobId = await submit(PROMPT);
    const autoJob = await waitForJob(
      autoJobId,
      ownerToken,
      acmeId,
      (row) => row.status === 'COMPLETED',
    );

    expect(autoJob.proposals).toHaveLength(0);
    expect(autoJob.toolNames).toEqual(['invoice.create']);
    expect(await invoiceCount()).toBe(before + 1);

    const toolLog = autoJob.logs.find((row) => {
      const output = row.output as { id?: unknown } | null;
      return typeof output?.id === 'string';
    });
    expect(toolLog).toBeTruthy();
    const invoiceId = (toolLog!.output as { id: string }).id;
    createdInvoiceIds.push(invoiceId);
    expect(autoJob.response).toContain('Created INV-');
    expect(autoJob.response).toContain('auto-execute policy');

    const invoice = await request(app.getHttpServer())
      .get(`/api/v1/invoices/${invoiceId}`)
      .set(withOrg(ownerToken, acmeId))
      .expect(200);
    expect(invoice.body.status).toBe('DRAFT');
    expect(invoice.body.customer.name).toBe('Northwind Studio');

    const audit = await prisma.auditLogEntry.findFirst({
      where: {
        organizationId: acmeId,
        action: 'agent.policy.update',
        entityType: 'AgentToolPolicy',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toBeTruthy();
    expect(audit!.metadata).toMatchObject({
      toolName: 'invoice.create',
      from: 'approve',
      to: 'auto',
      sensitive: true,
    });

    const restored = await setPolicy('invoice.create', 'approve');
    expect(restored.policy).toBe('approve');

    const beforeProposal = await invoiceCount();
    const proposalJobId = await submit(
      'Create a draft invoice for Harbor & Pine for 1 Design package at $500, due in 30 days.',
    );
    const proposalJob = await waitForJob(
      proposalJobId,
      ownerToken,
      acmeId,
      (row) => row.status === 'COMPLETED' && row.proposals.length === 1,
    );
    expect(proposalJob.proposals[0]).toMatchObject({
      toolName: 'invoice.create',
      status: 'PENDING',
    });
    expect(await invoiceCount()).toBe(beforeProposal);
  });

  it('keeps policy overrides tenant-scoped', async () => {
    await setPolicy('invoice.create', 'auto', ownerToken, acmeId);

    const nimbusPolicies = await policies(nimbusOwnerToken, nimbusId);
    expect(nimbusPolicies.find((row) => row.toolName === 'invoice.create')!.policy).toBe(
      'approve',
    );
    expect(
      await prisma.agentToolPolicy.count({ where: { organizationId: nimbusId } }),
    ).toBe(0);

    const acmePolicies = await policies(ownerToken, acmeId);
    expect(acmePolicies.find((row) => row.toolName === 'invoice.create')!).toMatchObject({
      policy: 'auto',
      updatedBy: { email: 'owner@acme.test' },
    });

    await setPolicy('invoice.create', 'approve', ownerToken, acmeId);
  });
});
