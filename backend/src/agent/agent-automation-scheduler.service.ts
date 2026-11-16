import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { redisConnectionOptions } from './agent-queue.service';

export const AGENT_AUTOMATIONS_QUEUE = 'agent-automations';

export interface AgentAutomationSchedule {
  id: string;
  organizationId: string;
  cron: string;
  timezone: string;
}

export function automationDriver(): 'inline' | 'bull' {
  return (process.env.AGENT_QUEUE_DRIVER ?? 'bull') === 'inline' ? 'inline' : 'bull';
}

/**
 * The only writer of repeatable jobs. The scheduler is deliberately kept away
 * from the runner, tool registry, and orchestrator so provider wiring stays a
 * DAG; the worker (`AgentAutomationWorker`) owns execution.
 *
 * Keying by automation id makes an edit replace the same schedule instead of
 * creating a duplicate, and deleting a row removes its schedule.
 */
@Injectable()
export class AgentAutomationScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentAutomationScheduler.name);
  private readonly inline = automationDriver() === 'inline';
  private readonly schedules = new Map<string, AgentAutomationSchedule>();
  private queue?: Queue;

  constructor(private readonly prisma: PrismaService) {}

  get driver(): 'inline' | 'bull' {
    return this.inline ? 'inline' : 'bull';
  }

  async onModuleInit(): Promise<void> {
    if (!this.inline) {
      const { Queue: BullQueue } = await import('bullmq');
      this.queue = new BullQueue(AGENT_AUTOMATIONS_QUEUE, {
        connection: redisConnectionOptions(),
      });
    }

    // Startup reconciliation: re-register every enabled schedule after a
    // restart. This is system boot, not a tenant request, so it intentionally
    // reads across organizations.
    const rows = await this.prisma.agentAutomation.findMany({
      where: { enabled: true, mode: 'CRON' },
      select: { id: true, organizationId: true, cron: true, timezone: true },
    });
    for (const row of rows) {
      try {
        await this.register(row);
      } catch (error) {
        this.logger.error(
          `Could not restore automation ${row.id}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }
  }

  async register(schedule: AgentAutomationSchedule): Promise<void> {
    if (this.inline) {
      this.schedules.set(schedule.id, { ...schedule });
      return;
    }
    if (!this.queue) throw new Error('Automation scheduler is not initialized');
    await this.queue.upsertJobScheduler(
      schedule.id,
      { pattern: schedule.cron, tz: schedule.timezone },
      {
        name: 'automation',
        data: {
          automationId: schedule.id,
          organizationId: schedule.organizationId,
        },
      },
    );
  }

  async remove(id: string): Promise<void> {
    if (this.inline) {
      this.schedules.delete(id);
      return;
    }
    if (!this.queue) return;
    await this.queue.removeJobScheduler(id);
  }

  /** Registered schedules; used by tests and diagnostics. */
  async list(): Promise<AgentAutomationSchedule[]> {
    if (this.inline) return [...this.schedules.values()];
    if (!this.queue) return [];
    const rows = await this.queue.getJobSchedulers(0, -1, true);
    return rows.map((row) => ({
      id: row.id ?? row.key,
      organizationId: row.template?.data?.organizationId ?? '',
      cron: row.pattern ?? '',
      timezone: row.tz ?? 'UTC',
    }));
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }
}
