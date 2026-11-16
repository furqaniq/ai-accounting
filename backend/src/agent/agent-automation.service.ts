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
import { resolveAgentModel } from './model-catalog';

const AUTOMATION_INCLUDE = {
  createdBy: { select: { id: true, name: true, email: true } },
} as const;

type AutomationRow = Prisma.AgentAutomationGetPayload<{
  include: typeof AUTOMATION_INCLUDE;
}>;

export interface CreateAgentAutomationInput {
  name: string;
  prompt: string;
  cron: string;
  timezone?: string;
  model?: string;
  enabled?: boolean;
}

export interface UpdateAgentAutomationInput {
  name?: string;
  prompt?: string;
  cron?: string;
  timezone?: string;
  model?: string;
  enabled?: boolean;
}

export interface AgentAutomationView {
  id: string;
  name: string;
  mode: AgentAutomationMode;
  cron: string;
  timezone: string;
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
  return {
    id: row.id,
    name: row.name,
    mode: row.mode,
    cron: row.cron,
    timezone: row.timezone,
    prompt: row.prompt,
    model: row.model,
    enabled: row.enabled,
    scheduleLabel: describeCron(row.cron),
    nextRunAt: row.enabled ? nextRunAt(row.cron, row.timezone) : null,
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
 * paused/deleted/replaced schedules cannot drift from their rows.
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
    const timezone = validateTimezone(input.timezone);
    const cron = validateCron(input.cron, timezone);
    const model = this.normalizeModel(input.model);
    const enabled = input.enabled ?? true;

    await this.assertNameAvailable(name);

    let row: AgentAutomation;
    try {
      row = await this.scoped.create<AgentAutomation>('agentAutomation', {
        name,
        mode: AgentAutomationMode.CRON,
        cron,
        timezone,
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

    if (enabled) {
      await this.scheduler.register({
        id: row.id,
        organizationId: row.organizationId,
        cron,
        timezone,
      });
    }

    await this.audit.record('agent.automation.create', 'AgentAutomation', row.id, {
      name,
      cron,
      timezone,
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
    const name =
      input.name === undefined ? existing.name : this.normalizeName(input.name);
    const prompt =
      input.prompt === undefined
        ? existing.prompt
        : this.normalizePrompt(input.prompt);
    const timezone =
      input.timezone === undefined
        ? existing.timezone
        : validateTimezone(input.timezone);
    const cron =
      input.cron === undefined
        ? validateCron(existing.cron, timezone)
        : validateCron(input.cron, timezone);
    const model =
      input.model === undefined
        ? existing.model
        : this.normalizeModel(input.model);
    const enabled = input.enabled ?? existing.enabled;

    if (name !== existing.name) await this.assertNameAvailable(name, id);

    await this.scoped.updateById('agentAutomation', id, {
      name,
      prompt,
      timezone,
      cron,
      model,
      enabled,
    });

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
        { name, changedByRole: role },
      );
    } else {
      await this.audit.record('agent.automation.update', 'AgentAutomation', id, {
        name,
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
    await this.scheduler.remove(id);
    await this.scoped.deleteById('agentAutomation', id);
    await this.audit.record('agent.automation.delete', 'AgentAutomation', id, {
      name: existing.name,
      cron: existing.cron,
      changedByRole: role,
    });
  }

  /** Guarded hook support: manager-only and paused automations cannot run. */
  async getRunnable(id: string): Promise<AgentAutomation> {
    await this.requireManager();
    const row = await this.requireRow(id);
    if (!row.enabled) {
      throw new ConflictException('Automation is paused');
    }
    return row;
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
