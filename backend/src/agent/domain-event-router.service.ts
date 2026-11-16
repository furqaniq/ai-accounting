import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { AgentAutomation, AgentAutomationMode } from '@prisma/client';
import { DomainEvent, DomainEventsService } from '../events/domain-events.service';
import { PrismaService } from '../prisma/prisma.service';
import { AgentAutomationRunner } from './agent-automation-runner.service';
import {
  matchesEventTrigger,
  storedEventConfig,
} from './domain-event.config';

/**
 * Routes a published domain event to enabled EVENT automations in the same
 * organization. This is system routing (not a tenant request), so it reads the
 * candidate rows directly, always filtered by the event's organization id.
 * Each matched automation becomes one normal AgentJob on the prompt queue.
 */
@Injectable()
export class DomainEventRouter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DomainEventRouter.name);
  private unsubscribe?: () => void;

  constructor(
    private readonly events: DomainEventsService,
    private readonly prisma: PrismaService,
    private readonly runner: AgentAutomationRunner,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.events.subscribe((event) => this.route(event));
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  async route(event: DomainEvent): Promise<void> {
    const candidates = await this.prisma.agentAutomation.findMany({
      where: {
        organizationId: event.organizationId,
        mode: AgentAutomationMode.EVENT,
        eventType: event.type,
        enabled: true,
      },
    });

    for (const automation of candidates) {
      const config = storedEventConfig(automation.eventConfig);
      if (!matchesEventTrigger(event.type, config, event.data)) continue;
      try {
        await this.runner.runEvent(automation, event);
      } catch (error) {
        this.logger.error(
          `Could not route ${event.type} to automation ${automation.id}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }
  }

  /** Exposed for tests: which automations would fire for this event. */
  async matchingAutomations(event: DomainEvent): Promise<AgentAutomation[]> {
    const candidates = await this.prisma.agentAutomation.findMany({
      where: {
        organizationId: event.organizationId,
        mode: AgentAutomationMode.EVENT,
        eventType: event.type,
        enabled: true,
      },
    });
    return candidates.filter((automation) =>
      matchesEventTrigger(
        event.type,
        storedEventConfig(automation.eventConfig),
        event.data,
      ),
    );
  }
}
