import { Injectable, Logger } from '@nestjs/common';
import { AgentDomainEventType } from '@prisma/client';

export interface DomainEventInput {
  organizationId: string;
  type: AgentDomainEventType;
  entityType: string;
  entityId: string;
  data?: Record<string, unknown>;
}

export interface DomainEvent {
  organizationId: string;
  type: AgentDomainEventType;
  entityType: string;
  entityId: string;
  occurredAt: string;
  data: Record<string, unknown>;
}

export type DomainEventHandler = (event: DomainEvent) => Promise<unknown> | unknown;

/**
 * Small in-process domain event bus. Feature services publish after their
 * transaction commits and audit rows are written; subscribers (the agent
 * router) run in-process and never receive a database handle they could use
 * to escape tenant scope.
 *
 * Handler failures are logged and swallowed so automation routing can never
 * fail the business action that emitted the event.
 */
@Injectable()
export class DomainEventsService {
  private readonly logger = new Logger(DomainEventsService.name);
  private readonly handlers = new Set<DomainEventHandler>();

  subscribe(handler: DomainEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async publish(input: DomainEventInput): Promise<DomainEvent> {
    const event: DomainEvent = {
      organizationId: input.organizationId,
      type: input.type,
      entityType: input.entityType,
      entityId: input.entityId,
      occurredAt: new Date().toISOString(),
      data: input.data ?? {},
    };

    for (const handler of [...this.handlers]) {
      try {
        await handler(event);
      } catch (error) {
        this.logger.error(
          `Domain event handler failed for ${event.type} ${event.entityId}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }
    return event;
  }
}
