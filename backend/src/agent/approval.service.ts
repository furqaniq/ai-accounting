import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AgentJob,
  AgentJobStatus,
  AgentProposal,
  AgentProposalStatus,
  AgentTrigger,
  Prisma,
  Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../tenant/audit.service';
import { hasPermission } from '../tenant/permissions';
import { ScopedDataAccess } from '../tenant/scoped-data-access.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { AgentLogService } from './agent-log.service';
import { ToolRegistry } from './tool-registry';

const PROPOSAL_INCLUDE = {
  requestedBy: { select: { id: true, name: true, email: true } },
  decidedBy: { select: { id: true, name: true, email: true } },
} as const;

type ProposalRow = Prisma.AgentProposalGetPayload<{
  include: typeof PROPOSAL_INCLUDE;
}>;

export interface CreateProposalInput {
  job: AgentJob;
  toolName: string;
  args: Record<string, unknown>;
  rationale?: string;
}

export interface ProposalFilters {
  status?: AgentProposalStatus;
  jobId?: string;
  limit?: number;
}

function jsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/**
 * Owns agent write-proposal creation, approval/rejection, and the
 * single-execution guarantee. Only this service calls
 * `ToolRegistry.executeApproved`, so no HTTP path can bypass approval.
 */
@Injectable()
export class ApprovalService {
  constructor(
    private readonly tenant: TenantContextService,
    private readonly prisma: PrismaService,
    private readonly scoped: ScopedDataAccess,
    private readonly logs: AgentLogService,
    private readonly audit: AuditService,
    private readonly registry: ToolRegistry,
  ) {}

  async createProposal(input: CreateProposalInput): Promise<ProposalRow> {
    const proposal = await this.scoped.create<AgentProposal>('agentProposal', {
      jobId: input.job.id,
      requestedByUserId: input.job.userId,
      toolName: input.toolName,
      args: jsonValue(input.args) ?? {},
      rationale: input.rationale?.trim() || null,
      status: AgentProposalStatus.PENDING,
    });

    const log = await this.logs.append({
      trigger: input.job.trigger,
      status: AgentJobStatus.COMPLETED,
      model: input.job.model,
      prompt: input.job.prompt,
      toolNames: [input.toolName],
      input: input.args,
      output: {
        proposalId: proposal.id,
        toolName: input.toolName,
        rationale: proposal.rationale,
        decision: 'PROPOSED',
      },
      jobId: input.job.id,
      proposalId: proposal.id,
      approvalStatus: AgentProposalStatus.PENDING,
    });

    await this.scoped.updateById('agentProposal', proposal.id, {
      logReference: log.logReference,
    });
    return this.find(proposal.id);
  }

  async list(filters: ProposalFilters = {}): Promise<ProposalRow[]> {
    const where: Record<string, unknown> = {};
    if (filters.status) where.status = filters.status;
    if (filters.jobId) where.jobId = filters.jobId;
    const take = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    return this.scoped.findMany<ProposalRow>('agentProposal', {
      where,
      orderBy: [{ createdAt: 'desc' }],
      take,
      include: PROPOSAL_INCLUDE,
    });
  }

  async listForJob(jobId: string): Promise<ProposalRow[]> {
    return this.scoped.findMany<ProposalRow>('agentProposal', {
      where: { jobId },
      orderBy: [{ createdAt: 'asc' }],
      include: PROPOSAL_INCLUDE,
    });
  }

  async find(id: string): Promise<ProposalRow> {
    const row = await this.scoped.findById<ProposalRow>('agentProposal', id, {
      include: PROPOSAL_INCLUDE,
    });
    if (!row) throw new NotFoundException('Agent proposal not found');
    return row;
  }

  async approve(id: string): Promise<ProposalRow> {
    const { role, organizationId } = await this.requireApprover();
    const approverId = this.tenant.userId()!;
    const existing = await this.find(id);

    const tool = this.registry.describe(existing.toolName);
    if (!tool) throw new BadRequestException('Agent proposal references an unknown tool');
    if (!hasPermission(role, tool.permission)) {
      throw new ForbiddenException('You do not have permission to execute this tool');
    }

    await this.markExecuting(id, organizationId, approverId);
    const job = await this.jobFor(existing, organizationId);
    const trigger = job?.trigger ?? AgentTrigger.PROMPT;
    const args = (existing.args ?? {}) as Record<string, unknown>;

    await this.logs.append({
      trigger,
      status: AgentJobStatus.COMPLETED,
      model: job?.model,
      toolNames: [existing.toolName],
      input: args,
      output: {
        proposalId: existing.id,
        decision: 'APPROVED',
        approverUserId: approverId,
        toolName: existing.toolName,
      },
      jobId: existing.jobId ?? undefined,
      proposalId: existing.id,
      approvalStatus: AgentProposalStatus.EXECUTING,
    });

    let result: unknown;
    let error: string | undefined;
    try {
      const execution = await this.registry.executeApproved(
        existing.toolName,
        role,
        args,
      );
      result = execution.result;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Tool execution failed';
    }

    const executedAt = new Date();
    await this.scoped.updateById<AgentProposal>('agentProposal', id, {
      status: error ? AgentProposalStatus.FAILED : AgentProposalStatus.EXECUTED,
      executedAt,
      error: error ?? null,
      result:
        error || result === undefined
          ? Prisma.JsonNull
          : (jsonValue(result) as Prisma.InputJsonValue),
    });

    await this.logs.append({
      trigger,
      status: error ? AgentJobStatus.FAILED : AgentJobStatus.COMPLETED,
      model: job?.model,
      toolNames: [existing.toolName],
      input: args,
      output: error
        ? { proposalId: existing.id, decision: 'APPROVED' }
        : { proposalId: existing.id, decision: 'EXECUTED', result },
      error,
      jobId: existing.jobId ?? undefined,
      proposalId: existing.id,
      approvalStatus: error
        ? AgentProposalStatus.FAILED
        : AgentProposalStatus.EXECUTED,
    });

    await this.audit.record(
      'agent.proposal.approve',
      'AgentProposal',
      existing.id,
      {
        toolName: existing.toolName,
        status: error ? AgentProposalStatus.FAILED : AgentProposalStatus.EXECUTED,
      },
    );

    return this.find(id);
  }

  async reject(id: string, reason?: string): Promise<ProposalRow> {
    const { organizationId } = await this.requireApprover();
    const approverId = this.tenant.userId()!;
    const existing = await this.find(id);

    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string; status: AgentProposalStatus }>>(
        Prisma.sql`
          SELECT id, status
          FROM "AgentProposal"
          WHERE id = ${id} AND "organizationId" = ${organizationId}
          FOR UPDATE
        `,
      );
      if (locked.length === 0) {
        throw new NotFoundException('Agent proposal not found');
      }
      if (locked[0].status !== AgentProposalStatus.PENDING) {
        throw new ConflictException('Agent proposal is no longer pending');
      }
      await tx.agentProposal.update({
        where: { id },
        data: {
          status: AgentProposalStatus.REJECTED,
          decidedByUserId: approverId,
          decidedAt: new Date(),
          decisionNote: reason?.trim() || null,
        },
      });
    });

    const job = await this.jobFor(existing, organizationId);
    await this.logs.append({
      trigger: job?.trigger ?? AgentTrigger.PROMPT,
      status: AgentJobStatus.COMPLETED,
      model: job?.model,
      toolNames: [existing.toolName],
      input: (existing.args ?? {}) as Record<string, unknown>,
      output: {
        proposalId: existing.id,
        decision: 'REJECTED',
        approverUserId: approverId,
        reason: reason?.trim() || null,
      },
      jobId: existing.jobId ?? undefined,
      proposalId: existing.id,
      approvalStatus: AgentProposalStatus.REJECTED,
    });

    await this.audit.record(
      'agent.proposal.reject',
      'AgentProposal',
      existing.id,
      { toolName: existing.toolName, reason: reason?.trim() || null },
    );

    return this.find(id);
  }

  private async markExecuting(
    id: string,
    organizationId: string,
    approverId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string; status: AgentProposalStatus }>>(
        Prisma.sql`
          SELECT id, status
          FROM "AgentProposal"
          WHERE id = ${id} AND "organizationId" = ${organizationId}
          FOR UPDATE
        `,
      );
      if (locked.length === 0) {
        throw new NotFoundException('Agent proposal not found');
      }
      if (locked[0].status !== AgentProposalStatus.PENDING) {
        throw new ConflictException('Agent proposal is no longer pending');
      }
      await tx.agentProposal.update({
        where: { id },
        data: {
          status: AgentProposalStatus.EXECUTING,
          decidedByUserId: approverId,
          decidedAt: new Date(),
        },
      });
    });
  }

  private async requireApprover(): Promise<{ role: Role; organizationId: string }> {
    const membership = await this.tenant.get();
    const role = membership.role as Role;
    if (!hasPermission(role, 'agent:approve')) {
      throw new ForbiddenException('Owner or Admin approval is required');
    }
    if (!this.tenant.userId()) throw new UnauthorizedException();
    return { role, organizationId: membership.organizationId };
  }

  private async jobFor(
    proposal: AgentProposal,
    organizationId: string,
  ): Promise<AgentJob | null> {
    if (!proposal.jobId) return null;
    return this.prisma.agentJob.findFirst({
      where: { id: proposal.jobId, organizationId },
    });
  }
}
