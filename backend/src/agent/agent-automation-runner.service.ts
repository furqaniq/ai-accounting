import { Injectable, Logger } from '@nestjs/common';
import { AgentJobStatus, AgentTrigger } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { resolveMembership } from '../tenant/membership-resolution';
import { TenantContextService } from '../tenant/tenant-context.service';
import { AgentJobsService } from './agent-jobs.service';
import { AgentQueueService } from './agent-queue.service';

export interface ScheduledRunResult {
  jobId: string | null;
  status: AgentJobStatus | null;
  logReference: string | null;
  skipped: boolean;
  reason?: string;
}

/**
 * Turns a due schedule into a normal AgentJob and enqueues it on the existing
 * prompt queue, so retries, logging, tools, and approvals all share one path.
 * The worker re-resolves the creator's membership before entering tenant
 * context; scoped services are never called before `runAs`.
 */
@Injectable()
export class AgentAutomationRunner {
  private readonly logger = new Logger(AgentAutomationRunner.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly jobs: AgentJobsService,
    private readonly queue: AgentQueueService,
  ) {}

  async runScheduled(
    automationId: string,
    organizationId: string,
  ): Promise<ScheduledRunResult> {
    const automation = await this.prisma.agentAutomation.findFirst({
      where: { id: automationId, organizationId },
    });
    if (!automation || automation.mode !== 'CRON') {
      return { jobId: null, status: null, logReference: null, skipped: true };
    }
    if (!automation.enabled) {
      return {
        jobId: null,
        status: null,
        logReference: null,
        skipped: true,
        reason: 'Automation is paused',
      };
    }

    const userId = automation.createdByUserId;
    const membership = await resolveMembership(
      this.prisma,
      userId,
      automation.organizationId,
    );
    if (!membership) {
      await this.markSkipped(automation.id, 'Creator no longer belongs to this organization');
      return {
        jobId: null,
        status: AgentJobStatus.FAILED,
        logReference: null,
        skipped: true,
        reason: 'Creator no longer belongs to this organization',
      };
    }

    return this.tenant.runAs(
      { user: { userId, email: '' }, membership },
      async () => {
        const { job, logReference } = await this.jobs.create({
          prompt: automation.prompt,
          modelAlias: automation.model ?? undefined,
          trigger: AgentTrigger.CRON,
          automationId: automation.id,
        });

        await this.prisma.agentAutomation.updateMany({
          where: { id: automation.id, organizationId: automation.organizationId },
          data: {
            lastRunAt: new Date(),
            lastStatus: AgentJobStatus.QUEUED,
            lastJobId: job.id,
            lastLogReference: logReference,
          },
        });

        await this.queue.enqueue({
          jobId: job.id,
          organizationId: automation.organizationId,
          userId,
        });

        this.logger.log(
          `Queued automation ${automation.id} as agent job ${job.id}`,
        );
        return {
          jobId: job.id,
          status: job.status,
          logReference,
          skipped: false,
        };
      },
    );
  }

  private async markSkipped(id: string, reason: string): Promise<void> {
    try {
      await this.prisma.agentAutomation.updateMany({
        where: { id },
        data: {
          lastRunAt: new Date(),
          lastStatus: AgentJobStatus.FAILED,
        },
      });
    } catch (error) {
      this.logger.error(
        `Could not mark automation ${id} failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
    this.logger.warn(`Skipped automation ${id}: ${reason}`);
  }
}
