import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.factory';
import { PrismaService } from '../prisma/prisma.service';

interface ProposalRow {
  id: string;
  jobId: string | null;
  toolName: string;
  args: Record<string, unknown>;
  rationale: string | null;
  status: string;
  decidedByUserId: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  logReference: string | null;
  requestedBy?: { id: string; name: string; email: string };
  decidedBy?: { id: string; name: string; email: string } | null;
}

interface ApprovalLogRow {
  id: string;
  trigger: string;
  status: string;
  toolNames: string[] | null;
  approvalStatus: string | null;
  proposalId: string | null;
  output: unknown;
  error: string | null;
}

interface JobBody {
  jobId: string;
  status: string;
  response: string | null;
  toolNames: string[];
  proposals: ProposalRow[];
  logs: ApprovalLogRow[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const PROMPT =
  'Create a draft invoice for Northwind Studio for 1 Consulting hour at $150, due in 30 days.';

describe('Agent write approvals', () => {
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

  async function propose(token = ownerToken): Promise<{ jobId: string; proposal: ProposalRow }> {
    const jobId = await submit(PROMPT, { token });
    const job = await waitForJob(
      jobId,
      token,
      acmeId,
      (row) => row.status === 'COMPLETED' && row.proposals.length === 1,
    );
    return { jobId, proposal: job.proposals[0] };
  }

  async function invoiceCount(): Promise<number> {
    return prisma.invoice.count({ where: { organizationId: acmeId } });
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
  });

  afterAll(async () => {
    if (createdInvoiceIds.length > 0) {
      await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } });
      await prisma.invoice.deleteMany({ where: { id: { in: createdInvoiceIds } } });
    }
    if (createdJobIds.length > 0) {
      await prisma.agentProposal.deleteMany({ where: { jobId: { in: createdJobIds } } });
      await prisma.agentActionLog.deleteMany({ where: { jobId: { in: createdJobIds } } });
      await prisma.agentJob.deleteMany({ where: { id: { in: createdJobIds } } });
    }
    await app.close();
  });

  it('proposes invoice.create to staff without creating an invoice', async () => {
    const before = await invoiceCount();
    const { proposal } = await propose(staffToken);

    expect(proposal.status).toBe('PENDING');
    expect(proposal.toolName).toBe('invoice.create');
    expect(proposal.args).toMatchObject({
      customerName: 'Northwind Studio',
      lines: [{ itemName: 'Consulting hour', quantity: 1 }],
    });
    expect(proposal.rationale).toContain('Owner or Admin');
    expect(proposal.logReference).toMatch(/^AGT-\d{4,}$/);
    expect(await invoiceCount()).toBe(before);

    const pending = await request(app.getHttpServer())
      .get('/api/v1/agent/approvals?status=PENDING')
      .set(withOrg(ownerToken, acmeId))
      .expect(200);
    expect((pending.body.approvals as ProposalRow[]).map((row) => row.id)).toContain(
      proposal.id,
    );

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/agent/approvals/${proposal.id}`)
      .set(withOrg(viewerToken, acmeId))
      .expect(200);
    expect(detail.body.id).toBe(proposal.id);
  });

  it('lets accountants propose while viewers cannot propose writes', async () => {
    const accountantProposal = await propose(accountantToken);
    expect(accountantProposal.proposal.status).toBe('PENDING');

    const viewerJobId = await submit(PROMPT, { token: viewerToken });
    const viewerJob = await waitForJob(
      viewerJobId,
      viewerToken,
      acmeId,
      (row) => row.status === 'COMPLETED',
    );
    expect(viewerJob.proposals).toHaveLength(0);
    expect(viewerJob.response).toContain('Owner or Admin approval');
  });

  it('approves once, executes invoice.create, and logs the decision', async () => {
    const before = await invoiceCount();
    const { jobId, proposal } = await propose();

    const approved = await request(app.getHttpServer())
      .post(`/api/v1/agent/approvals/${proposal.id}/approve`)
      .set(withOrg(ownerToken, acmeId))
      .expect(200);

    expect(approved.body.status).toBe('EXECUTED');
    expect(approved.body.decidedByUserId).toBeTruthy();
    expect(approved.body.result).toMatchObject({ status: 'DRAFT' });
    const invoiceId = (approved.body.result as { id: string }).id;
    createdInvoiceIds.push(invoiceId);
    expect(await invoiceCount()).toBe(before + 1);

    const invoice = await request(app.getHttpServer())
      .get(`/api/v1/invoices/${invoiceId}`)
      .set(withOrg(ownerToken, acmeId))
      .expect(200);
    expect(invoice.body.status).toBe('DRAFT');
    expect(invoice.body.customer.name).toBe('Northwind Studio');
    expect(invoice.body.lines[0]).toMatchObject({
      quantity: 1,
      unitPrice: 150,
      item: { name: 'Consulting hour' },
    });

    const job = await waitForJob(
      jobId,
      ownerToken,
      acmeId,
      (row) => row.status === 'COMPLETED',
    );
    expect(job.proposals[0].status).toBe('EXECUTED');
    expect(job.logs.some((row) => row.approvalStatus === 'PENDING')).toBe(true);
    expect(job.logs.some((row) => row.approvalStatus === 'EXECUTING')).toBe(true);
    expect(job.logs.some((row) => row.approvalStatus === 'EXECUTED')).toBe(true);
    const decision = job.logs.find(
      (row) =>
        row.approvalStatus === 'EXECUTING' &&
        (row.output as { decision?: string })?.decision === 'APPROVED',
    );
    expect(decision).toBeTruthy();
    expect(decision!.proposalId).toBe(proposal.id);

    const audit = await prisma.auditLogEntry.findFirst({
      where: {
        organizationId: acmeId,
        action: 'agent.proposal.approve',
        entityId: proposal.id,
      },
    });
    expect(audit).toBeTruthy();
  });

  it('rejects repeat and concurrent approvals while executing exactly once', async () => {
    const before = await invoiceCount();
    const { proposal } = await propose();

    const first = request(app.getHttpServer())
      .post(`/api/v1/agent/approvals/${proposal.id}/approve`)
      .set(withOrg(ownerToken, acmeId));
    const second = request(app.getHttpServer())
      .post(`/api/v1/agent/approvals/${proposal.id}/approve`)
      .set(withOrg(ownerToken, acmeId));
    const responses = await Promise.all([first, second]);
    const statuses = responses.map((res) => res.status).sort();
    expect(statuses).toEqual([200, 409]);

    const succeeded = responses.find((res) => res.status === 200)!;
    const invoiceId = (succeeded.body.result as { id: string }).id;
    createdInvoiceIds.push(invoiceId);
    expect(await invoiceCount()).toBe(before + 1);

    await request(app.getHttpServer())
      .post(`/api/v1/agent/approvals/${proposal.id}/approve`)
      .set(withOrg(ownerToken, acmeId))
      .expect(409);
    expect(await invoiceCount()).toBe(before + 1);
  });

  it('rejects a proposal without executing or changing the books', async () => {
    const before = await invoiceCount();
    const { jobId, proposal } = await propose(staffToken);

    const rejected = await request(app.getHttpServer())
      .post(`/api/v1/agent/approvals/${proposal.id}/reject`)
      .set(withOrg(ownerToken, acmeId))
      .send({ reason: 'Wrong client for this week' })
      .expect(200);

    expect(rejected.body.status).toBe('REJECTED');
    expect(rejected.body.decisionNote).toBe('Wrong client for this week');
    expect(await invoiceCount()).toBe(before);

    const job = await waitForJob(
      jobId,
      ownerToken,
      acmeId,
      (row) => row.status === 'COMPLETED',
    );
    expect(job.logs.some((row) => row.approvalStatus === 'REJECTED')).toBe(true);

    await request(app.getHttpServer())
      .post(`/api/v1/agent/approvals/${proposal.id}/approve`)
      .set(withOrg(ownerToken, acmeId))
      .expect(409);
  });

  it('blocks staff, accountants, and viewers from approving or rejecting', async () => {
    const { proposal } = await propose();

    for (const token of [staffToken, accountantToken, viewerToken]) {
      await request(app.getHttpServer())
        .post(`/api/v1/agent/approvals/${proposal.id}/approve`)
        .set(withOrg(token, acmeId))
        .expect(403);
      await request(app.getHttpServer())
        .post(`/api/v1/agent/approvals/${proposal.id}/reject`)
        .set(withOrg(token, acmeId))
        .send({})
        .expect(403);
    }

    const still = await request(app.getHttpServer())
      .get(`/api/v1/agent/approvals/${proposal.id}`)
      .set(withOrg(ownerToken, acmeId))
      .expect(200);
    expect(still.body.status).toBe('PENDING');
  });

  it('keeps proposals and jobs tenant-scoped', async () => {
    const { jobId, proposal } = await propose();

    await request(app.getHttpServer())
      .get(`/api/v1/agent/approvals/${proposal.id}`)
      .set(withOrg(ownerToken, nimbusId))
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/agent/approvals/${proposal.id}/approve`)
      .set(withOrg(nimbusOwnerToken, nimbusId))
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/agent/jobs/${jobId}`)
      .set(withOrg(nimbusOwnerToken, nimbusId))
      .expect(404);
  });

  it('does not expose an endpoint that executes a write tool directly', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/agent/execute')
      .set(withOrg(ownerToken, acmeId))
      .send({ tool: 'invoice.create', args: {} })
      .expect(404);
  });
});
