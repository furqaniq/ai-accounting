import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { Job, Queue, Worker } from 'bullmq';
import { maxAgentAttempts } from './agent-jobs.service';
import { AgentQueuePayload, AgentRunnerService } from './agent-runner.service';

export const AGENT_QUEUE_NAME = 'agent-prompts';
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;

export function retryDelayMs(attemptsMade: number): number {
  const exponential = Math.min(
    BASE_BACKOFF_MS * 2 ** Math.max(attemptsMade - 1, 0),
    MAX_BACKOFF_MS,
  );
  return exponential + Math.floor(Math.random() * 250);
}

export function redisConnectionOptions(): {
  host: string;
  port: number;
  password?: string;
  username?: string;
  db?: number;
  maxRetriesPerRequest: null;
} {
  const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  const db = url.pathname.replace('/', '');
  return {
    host: url.hostname,
    port: Number.parseInt(url.port || '6379', 10),
    username: url.username || undefined,
    password: url.password || undefined,
    db: db ? Number.parseInt(db, 10) : undefined,
    maxRetriesPerRequest: null,
  };
}

/**
 * Queue facade with two drivers: real BullMQ in Compose, and an in-process
 * driver for Jest (AGENT_QUEUE_DRIVER=inline). Both expose the same enqueue /
 * advance contract and share the same runner + retry semantics.
 */
@Injectable()
export class AgentQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentQueueService.name);
  private readonly inline: boolean;
  private readonly payloads = new Map<string, AgentQueuePayload>();
  private readonly inFlight = new Set<string>();
  private queue?: Queue;
  private worker?: Worker;

  constructor(private readonly runner: AgentRunnerService) {
    this.inline = (process.env.AGENT_QUEUE_DRIVER ?? 'bull') === 'inline';
  }

  get driver(): 'inline' | 'bull' {
    return this.inline ? 'inline' : 'bull';
  }

  async onModuleInit(): Promise<void> {
    if (this.inline) return;
    const { Queue: BullQueue, Worker: BullWorker } = await import('bullmq');
    const connection = redisConnectionOptions();
    this.queue = new BullQueue(AGENT_QUEUE_NAME, { connection });
    this.worker = new BullWorker(
      AGENT_QUEUE_NAME,
      async (job: Job<AgentQueuePayload>) => {
        const outcome = await this.runner.run(job.data);
        if (outcome.status === 'retry') {
          throw new Error(outcome.error);
        }
        return outcome;
      },
      {
        connection,
        settings: {
          backoffStrategy: (attemptsMade: number) => retryDelayMs(attemptsMade),
        },
      },
    );
    this.worker.on('error', (error) => {
      this.logger.error(`Agent worker error: ${error.message}`);
    });
  }

  async enqueue(payload: AgentQueuePayload): Promise<void> {
    if (this.inline) {
      this.payloads.set(payload.jobId, payload);
      setImmediate(() => {
        void this.runInline(payload.jobId);
      });
      return;
    }
    if (!this.queue) {
      throw new Error('Agent queue is not initialized');
    }
    await this.queue.add('prompt', payload, {
      jobId: payload.jobId,
      attempts: maxAgentAttempts(),
      backoff: { type: 'custom' },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    });
  }

  async advance(jobId: string): Promise<boolean> {
    if (this.inline) {
      if (!this.payloads.has(jobId) || this.inFlight.has(jobId)) {
        return false;
      }
      await this.runInline(jobId);
      return true;
    }
    if (!this.queue) return false;
    const job = await this.queue.getJob(jobId);
    if (!job) return false;
    const state = await job.getState();
    if (state === 'delayed') {
      await job.promote();
      return true;
    }
    return false;
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  private async runInline(jobId: string): Promise<void> {
    const payload = this.payloads.get(jobId);
    if (!payload || this.inFlight.has(jobId)) return;
    this.inFlight.add(jobId);
    try {
      const outcome = await this.runner.run(payload);
      if (outcome.status !== 'retry') {
        this.payloads.delete(jobId);
      }
    } catch (error) {
      this.logger.error(
        `Inline agent run failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      this.payloads.delete(jobId);
    } finally {
      this.inFlight.delete(jobId);
    }
  }
}
