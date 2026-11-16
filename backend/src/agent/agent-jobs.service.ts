import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AgentJob, AgentJobStatus, AgentTrigger } from '@prisma/client';
import { ScopedDataAccess } from '../tenant/scoped-data-access.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { AgentLogService } from './agent-log.service';
import { resolveAgentModel } from './model-catalog';

export interface CreateAgentJobInput {
  prompt: string;
  modelAlias?: string;
  trigger?: AgentTrigger;
}

export interface AgentJobView {
  jobId: string;
  status: AgentJobStatus;
  attempts: number;
  maxAttempts: number;
  model: string;
  prompt: string;
  response: string | null;
  error: string | null;
  toolNames: string[];
  logReference: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function maxAgentAttempts(): number {
  const parsed = Number.parseInt(process.env.AGENT_MAX_ATTEMPTS ?? '3', 10);
  if (!Number.isFinite(parsed)) return 3;
  return Math.min(Math.max(parsed, 1), 5);
}

export function toAgentJobView(job: AgentJob): AgentJobView {
  const toolNames = Array.isArray(job.toolNames)
    ? (job.toolNames as string[])
    : [];
  return {
    jobId: job.id,
    status: job.status,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    model: job.model,
    prompt: job.prompt,
    response: job.response,
    error: job.error,
    toolNames,
    logReference: job.logReference,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

@Injectable()
export class AgentJobsService {
  constructor(
    private readonly tenant: TenantContextService,
    private readonly scoped: ScopedDataAccess,
    private readonly logs: AgentLogService,
  ) {}

  async create(input: CreateAgentJobInput): Promise<{
    job: AgentJob;
    logReference: string;
  }> {
    const { role } = await this.tenant.get();
    const userId = this.tenant.userId();
    if (!userId) throw new UnauthorizedException();
    const resolved = resolveAgentModel(input.modelAlias);
    const trigger = input.trigger ?? AgentTrigger.PROMPT;

    const job = await this.scoped.create<AgentJob>('agentJob', {
      userId,
      role,
      trigger,
      prompt: input.prompt,
      model: resolved.alias,
      status: AgentJobStatus.QUEUED,
      maxAttempts: maxAgentAttempts(),
    });

    const log = await this.logs.append({
      trigger,
      status: AgentJobStatus.QUEUED,
      model: resolved.alias,
      prompt: input.prompt,
      input: { prompt: input.prompt, model: resolved.alias },
      jobId: job.id,
    });

    await this.scoped.updateById('agentJob', job.id, { logReference: log.logReference });
    return {
      job: { ...job, logReference: log.logReference },
      logReference: log.logReference,
    };
  }

  async find(id: string): Promise<AgentJob> {
    const job = await this.scoped.findById<AgentJob>('agentJob', id);
    if (!job) throw new NotFoundException('Agent job not found');
    return job;
  }

  async beginAttempt(id: string): Promise<AgentJob | null> {
    const job = await this.find(id);
    if (job.status === AgentJobStatus.COMPLETED) {
      return null;
    }
    const updated = await this.scoped.updateById<AgentJob>('agentJob', id, {
      status: AgentJobStatus.RUNNING,
      attempts: job.attempts + 1,
      error: null,
      response: null,
    });
    return updated ?? null;
  }

  async markRetrying(id: string, error: string, logReference: string): Promise<void> {
    await this.scoped.updateById('agentJob', id, {
      status: AgentJobStatus.RETRYING,
      error,
      logReference,
    });
  }

  async markFailed(id: string, error: string, logReference: string): Promise<void> {
    await this.scoped.updateById('agentJob', id, {
      status: AgentJobStatus.FAILED,
      error,
      logReference,
    });
  }

  async markCompleted(
    id: string,
    response: string,
    toolNames: string[],
    logReference: string,
  ): Promise<void> {
    await this.scoped.updateById('agentJob', id, {
      status: AgentJobStatus.COMPLETED,
      response,
      error: null,
      toolNames,
      logReference,
    });
  }
}
