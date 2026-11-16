import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AgentAutomation,
  AgentAutomationMode,
  AgentDomainEventType,
  AgentJobStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { AuditService } from '../tenant/audit.service';
import { hasPermission } from '../tenant/permissions';
import { ScopedDataAccess } from '../tenant/scoped-data-access.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import {
  describeCron,
  nextRunAt,
  validateCron,
  validateTimezone,
} from './agent-automation.schedule';
import { AgentAutomationScheduler } from './agent-automation-scheduler.service';
import {
  describeEventTrigger,
  EventTriggerConfig,
  normalizeEventConfig,
  storedEventConfig,
} from './domain-event.config';
import { resolveAgentModel } from './model-catalog';

const AUTOMATION_INCLUDE = {
  createdBy: { select: { id: true, name: true, email: true } },
} as const;

type AutomationRow = Prisma.AgentAutomationGetPayload<{
  include: typeof AUTOMATION_INCLUDE;
}>;

export type AgentAutomationModeInput = 'CRON' | 'EVENT';

export interface CreateAgentAutomationInput {
  name: string;
  prompt: string;
  mode?: AgentAutomationModeInput;
  cron?: string;
  timezone?: string;
  eventType?: AgentDomainEventType;
  eventConfig?: Record<string, unknown>;
  model?: string;
  enabled?: boolean;
}

export interface UpdateAgentAutomationInput {
  name?: string;
  prompt?: string;
  cron?: string;
  timezone?: string;
  eventType?: AgentDomainEventType;
  eventConfig?: Record<string, unknown>;
  model?: string;
  enabled?: boolean;
}

export interface AgentAutomationView {
  id: string;
  name: string;
  mode: AgentAutomationMode;
  cron: string | null;
  timezone: string;
  eventType: AgentDomainEventType | null;
  eventConfig: EventTriggerConfig | null;
  prompt: string;
  model: string | null;
  enabled: boolean;
  scheduleLabel: string;
  nextRunAt: string | null;
  createdBy: { id: string; name: string; email: string } | null;
  lastRunAt: Date | null;
  lastStatus: AgentJobStatus | null;
  lastJobId: string | null;
  lastLogReference: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toAgentAutomationView(row: AutomationRow): AgentAutomationView {
  const isEvent = row.mode === AgentAutomationMode.EVENT;
  const eventConfig = isEvent ? storedEventConfig(row.eventConfig) : null;
  return {
    id: row.id,
    name: row.name,
    mode: row.mode,
    cron: row.cron,
    timezone: row.timezone,
    eventType: row.eventType,
    eventConfig,
    prompt: row.prompt,
    model: row.model,
    enabled: row.enabled,
    scheduleLabel:
      isEvent && row.eventType
        ? describeEventTrigger(row.eventType, eventConfig ?? {})
        : row.cron
          ? describeCron(row.cron)
          : '',
    nextRunAt:
      !isEvent && row.enabled && row.cron
        ? nextRunAt(row.cron, row.timezone)
        : null,
    createdBy: row.createdBy ?? null,
    lastRunAt: row.lastRunAt,
    lastStatus: row.lastStatus,
    lastJobId: row.lastJobId,
    lastLogReference: row.lastLogReference,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Tenant-facing automation CRUD. The service is the only scheduler writer, so
 * paused/deleted/replaced schedules cannot drift from their rows. EVENT
 * automations never touch the repeatable-job scheduler.
 */
@Injectable()
export class AgentAutomationService {
  constructor(
    private readonly tenant: TenantContextService,
    private readonly scoped: ScopedDataAccess,
    private readonly audit: AuditService,
    private readonly scheduler: AgentAutomationScheduler,
  ) {}

  async list(): Promise<AgentAutomationView[]> {
    const rows = await this.scoped.findMany<AutomationRow>('agentAutomation', {
      orderBy: [{ createdAt: 'desc' }],
      include: AUTOMATION_INCLUDE,
    });
    return rows.map(toAgentAutomationView);
  }

  async find(id: string): Promise<AgentAutomationView> {
    return toAgentAutomationView(await this.requireRow(id));
  }

  async create(input: CreateAgentAutomationInput): Promise<AgentAutomationView> {
    const { role } = await this.requireManager();
    const userId = this.tenant.userId()!;
    const name = this.normalizeName(input.name);
    const prompt = this.normalizePrompt(input.prompt);
    const model = this.normalizeModel(input.model);
    const enabled = input.enabled ?? true;
    const mode =
      input.mode === 'EVENT'
        ? AgentAutomationMode.EVENT
        : AgentAutomationMode.CRON;

    const schedule =
      mode === AgentAutomationMode.CRON
        ? this.resolveSchedule(input.cron, input.timezone)
        : null;
    const event =
      mode === AgentAutomationMode.EVENT
        ? this.resolveEvent(input.eventType, input.eventConfig)
        : null;

    await this.assertNameAvailable(name);

    let row: AgentAutomation;
    try {
      row = await this.scoped.create<AgentAutomation>('agentAutomation', {
        name,
        mode,
        cron: schedule?.cron ?? null,
        timezone: schedule?.timezone ?? 'UTC',
        eventType: event?.eventType ?? null,
        eventConfig: event?.eventConfig as Prisma.InputJsonValue ?? Prisma.JsonNull,
        prompt,
        model,
        enabled,
        createdByUserId: userId,
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('An automation with that name already exists');
      }
      throw error;
    }

    if (enabled && schedule) {
      await this.scheduler.register({
        id: row.id,
        organizationId: row.organizationId,
        cron: schedule.cron,
        timezone: schedule.timezone,
      });
    }

    await this.audit.record('agent.automation.create', 'AgentAutomation', row.id, {
      name,
      mode,
      ...(schedule
        ? { cron: schedule.cron, timezone: schedule.timezone }
        : {}),
      ...(event
        ? { eventType: event.eventType, eventConfig: event.eventConfig }
        : {}),
      enabled,
      changedByRole: role,
    });
    return this.find(row.id);
  }

  async update(
    id: string,
    input: UpdateAgentAutomationInput,
  ): Promise<AgentAutomationView> {
    const { role } = await this.requireManager();
    const existing = await this.requireRow(id);
    const isEvent = existing.mode === AgentAutomationMode.EVENT;
    const name =
      input.name === undefined ? existing.name : this.normalizeName(input.name);
    const prompt =
      input.prompt === undefined
        ? existing.prompt
        : this.normalizePrompt(input.prompt);
    const model =
      input.model === undefined
        ? existing.model
        : this.normalizeModel(input.model);
    const enabled = input.enabled ?? existing.enabled;

    if (isEvent) {
      if (input.cron !== undefined) {
        throw new BadRequestException('Event automations cannot have a cron schedule');
      }
      if (input.eventType === undefined && input.eventConfig === undefined) {
        // Nothing trigger-specific to update.
        await this.applyUpdate(id, name, prompt, model, enabled);
        await this.recordUpdateAudit(id, existing, { name, enabled, mode: existing.mode, role });
        return this.find(id);
      }
      const nextType = input.eventType ?? existing.eventType ?? undefined;
      const nextConfig =
        input.eventConfig !== undefined
          ? this.resolveEvent(nextType, input.eventConfig)!
          : input.eventType !== undefined && input.eventType !== existing.eventType
            ? this.resolveEvent(input.eventType, undefined)!
            : {
                eventType: existing.eventType!,
                eventConfig: storedEventConfig(existing.eventConfig),
              };

      await this.scoped.updateById('agentAutomation', id, {
        name,
        prompt,
        model,
        enabled,
        eventType: nextConfig.eventType,
        eventConfig: nextConfig.eventConfig as Prisma.InputJsonValue,
      });

      if (enabled !== existing.enabled) {
        await this.audit.record(
          enabled ? 'agent.automation.resume' : 'agent.automation.pause',
          'AgentAutomation',
          id,
          { name, mode: existing.mode, changedByRole: role },
        );
      } else {
        await this.audit.record('agent.automation.update', 'AgentAutomation', id, {
          name,
          mode: existing.mode,
          eventType: nextConfig.eventType,
          eventConfig: nextConfig.eventConfig,
          enabled,
          changedByRole: role,
        });
      }
      return this.find(id);
    }

    if (input.eventType !== undefined || input.eventConfig !== undefined) {
      throw new BadRequestException(
        'Scheduled automations cannot have event trigger settings',
      );
    }

    const timezone =
      input.timezone === undefined
        ? existing.timezone
        : validateTimezone(input.timezone);
    const cron =
      input.cron === undefined
        ? validateCron(existing.cron ?? '', timezone)
        : validateCron(input.cron, timezone);

    if (name !== existing.name) await this.assertNameAvailable(name, id);

    await this.applyUpdate(id, name, prompt, model, enabled, timezone, cron);

    const scheduleChanged =
      cron !== existing.cron || timezone !== existing.timezone;
    const toggled = enabled !== existing.enabled;

    if (enabled && (scheduleChanged || toggled)) {
      await this.scheduler.register({
        id,
        organizationId: existing.organizationId,
        cron,
        timezone,
      });
    } else if (!enabled && toggled) {
      await this.scheduler.remove(id);
    }

    if (toggled) {
      await this.audit.record(
        enabled ? 'agent.automation.resume' : 'agent.automation.pause',
        'AgentAutomation',
        id,
        { name, mode: existing.mode, changedByRole: role },
      );
    } else {
      await this.audit.record('agent.automation.update', 'AgentAutomation', id, {
        name,
        mode: existing.mode,
        cron,
        timezone,
        enabled,
        scheduleChanged,
        changedByRole: role,
      });
    }

    return this.find(id);
  }

  async remove(id: string): Promise<void> {
    const { role } = await this.requireManager();
    const existing = await this.requireRow(id);
    if (existing.mode === AgentAutomationMode.CRON) {
      await this.scheduler.remove(id);
    }
    await this.scoped.deleteById('agentAutomation', id);
    await this.audit.record('agent.automation.delete', 'AgentAutomation', id, {
      name: existing.name,
      mode: existing.mode,
      cron: existing.cron,
      eventType: existing.eventType,
      changedByRole: role,
    });
  }

  /** Guarded hook support: manager-only and paused automations cannot run. */
  async getRunnable(id: string): Promise<AgentAutomation> {
    await this.requireManager();
    const row = await this.requireRow(id);
    if (row.mode !== AgentAutomationMode.CRON) {
      throw new ConflictException(
        'Only scheduled automations can run from this hook',
      );
    }
    if (!row.enabled) {
      throw new ConflictException('Automation is paused');
    }
    return row;
  }

  private async applyUpdate(
    id: string,
    name: string,
    prompt: string,
    model: string | null,
    enabled: boolean,
    timezone?: string,
    cron?: string,
  ): Promise<void> {
    await this.scoped.updateById('agentAutomation', id, {
      name,
      prompt,
      model,
      enabled,
      ...(timezone !== undefined ? { timezone } : {}),
      ...(cron !== undefined ? { cron } : {}),
    });
  }

  private async recordUpdateAudit(
    id: string,
    existing: AutomationRow,
    input: { name: string; enabled: boolean; mode: AgentAutomationMode; role: Role },
  ): Promise<void> {
    if (input.enabled !== existing.enabled) {
      await this.audit.record(
        input.enabled ? 'agent.automation.resume' : 'agent.automation.pause',
        'AgentAutomation',
        id,
        { name: input.name, mode: input.mode, changedByRole: input.role },
      );
      return;
    }
    await this.audit.record('agent.automation.update', 'AgentAutomation', id, {
      name: input.name,
      mode: input.mode,
      eventType: existing.eventType,
      enabled: input.enabled,
      changedByRole: input.role,
    });
  }

  private resolveSchedule(
    cron: string | undefined,
    timezone: string | undefined,
  ): { cron: string; timezone: string } {
    const zone = validateTimezone(timezone);
    return { cron: validateCron(cron, zone), timezone: zone };
  }

  private resolveEvent(
    eventType: AgentDomainEventType | undefined,
    eventConfig: Record<string, unknown> | undefined,
  ): { eventType: AgentDomainEventType; eventConfig: Record<string, number> } {
    if (!eventType) {
      throw new BadRequestException('eventType is required for event automations');
    }
    if (!Object.values(AgentDomainEventType).includes(eventType)) {
      throw new BadRequestException(`Unknown event type: ${eventType}`);
    }
    return {
      eventType,
      eventConfig: normalizeEventConfig(eventType, eventConfig),
    };
  }

  private async requireRow(id: string): Promise<AutomationRow> {
    const rows = await this.scoped.findMany<AutomationRow>('agentAutomation', {
      where: { id },
      take: 1,
      include: AUTOMATION_INCLUDE,
    });
    if (rows.length === 0) throw new NotFoundException('Automation not found');
    return rows[0];
  }

  private async assertNameAvailable(name: string, excludeId?: string): Promise<void> {
    const rows = await this.scoped.findMany<AgentAutomation>('agentAutomation', {
      where: excludeId ? { name, id: { not: excludeId } } : { name },
      take: 1,
    });
    if (rows.length > 0) {
      throw new ConflictException('An automation with that name already exists');
    }
  }

  private normalizeName(name?: string): string {
    const value = (name ?? '').trim();
    if (!value) throw new BadRequestException('Automation name is required');
    return value;
  }

  private normalizePrompt(prompt?: string): string {
    const value = (prompt ?? '').trim();
    if (!value) throw new BadRequestException('Automation prompt is required');
    return value;
  }

  private normalizeModel(model?: string): string | null {
    const value = (model ?? '').trim();
    if (!value) return null;
    return resolveAgentModel(value).alias;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private async requireManager(): Promise<{ role: Role }> {
    const membership = await this.tenant.get();
    const role = membership.role as Role;
    if (!hasPermission(role, 'agent:manage')) {
      throw new ForbiddenException('Automation management is not available to this role');
    }
    if (!this.tenant.userId()) throw new UnauthorizedException();
    return { role };
  }
}
