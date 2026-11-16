import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AgentJobStatus,
  AgentProposalStatus,
  AgentTrigger,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScopedDataAccess } from '../tenant/scoped-data-access.service';
import { TenantContextService } from '../tenant/tenant-context.service';

export interface AppendAgentLogInput {
  trigger: AgentTrigger;
  status: AgentJobStatus;
  model?: string;
  prompt?: string;
  toolNames?: string[];
  input?: unknown;
  output?: unknown;
  error?: string;
  jobId?: string;
  proposalId?: string;
  approvalStatus?: AgentProposalStatus;
}

export interface AgentLogFilters {
  trigger?: AgentTrigger;
  status?: AgentJobStatus;
  jobId?: string;
  limit?: number;
}

function jsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/**
 * Append-only writer for AgentActionLog. There is intentionally no update or
 * delete path: corrections are new rows, never mutations.
 */
@Injectable()
export class AgentLogService {
  constructor(
    private readonly tenant: TenantContextService,
    private readonly prisma: PrismaService,
    private readonly scoped: ScopedDataAccess,
  ) {}

  async append(input: AppendAgentLogInput): Promise<{
    id: string;
    logReference: string;
  }> {
    const { organizationId } = await this.tenant.get();
    const actorUserId = this.tenant.userId() ?? null;

    for (let offset = 0; offset < 8; offset += 1) {
      const count = await this.prisma.agentActionLog.count({ where: { organizationId } });
      const logReference = `AGT-${String(count + 1 + offset).padStart(4, '0')}`;
      try {
        const row = await this.prisma.agentActionLog.create({
          data: {
            organizationId,
            actorUserId,
            trigger: input.trigger,
            status: input.status,
            model: input.model,
            prompt: input.prompt,
            toolNames: jsonValue(input.toolNames),
            input: jsonValue(input.input),
            output: jsonValue(input.output),
            error: input.error,
            jobId: input.jobId,
            proposalId: input.proposalId,
            approvalStatus: input.approvalStatus,
            logReference,
          },
          select: { id: true, logReference: true },
        });
        return row;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          continue;
        }
        throw error;
      }
    }
    throw new Error('Could not allocate an agent log reference');
  }

  async list(filters: AgentLogFilters): Promise<unknown[]> {
    const where: Record<string, unknown> = {};
    if (filters.trigger) where.trigger = filters.trigger;
    if (filters.status) where.status = filters.status;
    if (filters.jobId) where.jobId = filters.jobId;
    const take = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    return this.scoped.findMany('agentActionLog', {
      where,
      orderBy: { createdAt: 'desc' },
      take,
      include: { actor: { select: { id: true, name: true, email: true } } },
    });
  }

  async find(id: string): Promise<unknown> {
    const row = await this.scoped.findById('agentActionLog', id, {
      include: { actor: { select: { id: true, name: true, email: true } } },
    });
    if (!row) throw new NotFoundException('Agent log entry not found');
    return row;
  }
}
