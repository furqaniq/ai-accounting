import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { Job, Worker } from 'bullmq';
import { automationDriver, AGENT_AUTOMATIONS_QUEUE } from './agent-automation-scheduler.service';
import { AgentAutomationRunner } from './agent-automation-runner.service';
import { redisConnectionOptions } from './agent-queue.service';

interface AutomationJobData {
  automationId: string;
  organizationId: string;
}

/** BullMQ consumer for scheduled automations. Inline Jest runs use the runner directly. */
@Injectable()
export class AgentAutomationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentAutomationWorker.name);
  private readonly inline = automationDriver() === 'inline';
  private worker?: Worker;

  constructor(private readonly runner: AgentAutomationRunner) {}

  async onModuleInit(): Promise<void> {
    if (this.inline) return;
    const { Worker: BullWorker } = await import('bullmq');
    this.worker = new BullWorker(
      AGENT_AUTOMATIONS_QUEUE,
      async (job: Job<AutomationJobData>) => {
        const data = job.data;
        if (!data?.automationId || !data?.organizationId) return;
        return this.runner.runScheduled(data.automationId, data.organizationId);
      },
      { connection: redisConnectionOptions() },
    );
    this.worker.on('error', (error) => {
      this.logger.error(`Automation worker error: ${error.message}`);
    });
    this.worker.on('failed', (job, error) => {
      this.logger.error(
        `Automation job ${job?.id ?? 'unknown'} failed: ${error.message}`,
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
