import { Injectable, Logger } from '@nestjs/common';
import { AgentJobStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { resolveMembership } from '../tenant/membership-resolution';
import { TenantContextService } from '../tenant/tenant-context.service';
import { AgentJobsService } from './agent-jobs.service';
import { AgentLogService } from './agent-log.service';
import { AgentOrchestrator } from './orchestrator.service';
import {
  isRateLimitError,
  RetryableProviderError,
  shouldRetry,
} from './provider.types';

export interface AgentQueuePayload {
  jobId: string;
  organizationId: string;
  userId: string;
}

export type AgentRunOutcome =
  | { status: 'completed' }
  | { status: 'retry'; error: string }
  | { status: 'failed'; error: string };

@Injectable()
export class AgentRunnerService {
  private readonly logger = new Logger(AgentRunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly jobs: AgentJobsService,
    private readonly logs: AgentLogService,
    private readonly orchestrator: AgentOrchestrator,
  ) {}

  async run(payload: AgentQueuePayload): Promise<AgentRunOutcome> {
    const membership = await resolveMembership(
      this.prisma,
      payload.userId,
      payload.organizationId,
    );
    if (!membership) {
      await this.prisma.agentJob.updateMany({
        where: { id: payload.jobId, organizationId: payload.organizationId },
        data: {
          status: AgentJobStatus.FAILED,
          error: 'Actor no longer belongs to this organization',
        },
      });
      return { status: 'failed', error: 'Actor no longer belongs to this organization' };
    }

    return this.tenant.runAs(
      {
        user: { userId: payload.userId, email: '' },
        membership,
      },
      async (): Promise<AgentRunOutcome> => this.execute(payload.jobId),
    );
  }

  private async execute(jobId: string): Promise<AgentRunOutcome> {
    const job = await this.jobs.beginAttempt(jobId);
    if (!job) return { status: 'completed' };

    try {
      const result = await this.orchestrator.run(job);
      await this.jobs.markCompleted(
        job.id,
        result.response,
        result.toolNames,
        result.logReference,
      );
      return { status: 'completed' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Agent run failed';
      const retryable =
        error instanceof RetryableProviderError || isRateLimitError(error);
      const retry = shouldRetry(job.attempts, job.maxAttempts, retryable);
      const status = retry ? AgentJobStatus.RETRYING : AgentJobStatus.FAILED;

      let logReference = `attempt-${job.attempts}`;
      try {
        const log = await this.logs.append({
          trigger: job.trigger,
          status,
          model: job.model,
          toolNames: Array.isArray(job.toolNames)
            ? (job.toolNames as string[])
            : undefined,
          output: { attempt: job.attempts, maxAttempts: job.maxAttempts },
          error: message,
          jobId: job.id,
        });
        logReference = log.logReference;
      } catch (logError) {
        this.logger.error(
          `Could not append agent ${retry ? 'retry' : 'failure'} log: ${
            logError instanceof Error ? logError.message : 'unknown error'
          }`,
        );
      }

      if (retry) {
        await this.jobs.markRetrying(job.id, message, logReference);
        return { status: 'retry', error: message };
      }
      await this.jobs.markFailed(job.id, message, logReference);
      return { status: 'failed', error: message };
    }
  }
}
