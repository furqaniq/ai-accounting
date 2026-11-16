import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AgentToolPolicy,
  AgentToolPolicyMode,
  Prisma,
  Role,
} from '@prisma/client';
import { AuditService } from '../tenant/audit.service';
import { hasPermission, Permission } from '../tenant/permissions';
import { ScopedDataAccess } from '../tenant/scoped-data-access.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { AgentTool, ToolPolicy, ToolRegistry } from './tool-registry';

const POLICY_INCLUDE = {
  updatedBy: { select: { id: true, name: true, email: true } },
} as const;

type PolicyRow = Prisma.AgentToolPolicyGetPayload<{
  include: typeof POLICY_INCLUDE;
}>;

export interface AgentPolicyView {
  id: string | null;
  toolName: string;
  description: string;
  permission: Permission;
  readOnly: boolean;
  sensitive: boolean;
  configurable: boolean;
  defaultPolicy: ToolPolicy;
  policy: ToolPolicy;
  updatedAt: Date | null;
  updatedBy: { id: string; name: string; email: string } | null;
}

function modeToPolicy(mode: AgentToolPolicyMode): ToolPolicy {
  return mode === AgentToolPolicyMode.AUTO ? 'auto' : 'approve';
}

function policyToMode(policy: ToolPolicy): AgentToolPolicyMode {
  return policy === 'auto' ? AgentToolPolicyMode.AUTO : AgentToolPolicyMode.APPROVE;
}

/**
 * Per-organization execution policy for registered agent tools. Reads happen
 * at run time in the worker, so a saved override applies to the next run
 * without a restart. Read-only tools are always auto and never configurable;
 * write tools keep their sensitive default until an Owner or Admin changes it.
 */
@Injectable()
export class AgentPolicyService {
  constructor(
    private readonly tenant: TenantContextService,
    private readonly scoped: ScopedDataAccess,
    private readonly audit: AuditService,
    private readonly registry: ToolRegistry,
  ) {}

  async list(): Promise<AgentPolicyView[]> {
    const overrides = await this.scoped.findMany<PolicyRow>('agentToolPolicy', {
      include: POLICY_INCLUDE,
    });
    const byName = new Map(overrides.map((row) => [row.toolName, row]));
    return this.registry
      .listAll()
      .map((tool) => this.toView(tool, byName.get(tool.name)));
  }

  /** The effective policy for the next tool call in this organization. */
  async resolve(toolName: string): Promise<ToolPolicy | null> {
    const tool = this.registry.describe(toolName);
    if (!tool) return null;
    if (tool.readOnly) return 'auto';
    const rows = await this.scoped.findMany<AgentToolPolicy>('agentToolPolicy', {
      where: { toolName },
      take: 1,
    });
    const override = rows[0];
    return override ? modeToPolicy(override.policy) : tool.policy;
  }

  async update(toolName: string, policy: ToolPolicy): Promise<AgentPolicyView> {
    const { role } = await this.requirePolicyManager();
    const userId = this.tenant.userId()!;
    const tool = this.registry.describe(toolName);
    if (!tool) throw new NotFoundException(`Unknown tool: ${toolName}`);
    if (tool.readOnly) {
      throw new BadRequestException('Read-only tools always execute automatically');
    }

    const existing = (
      await this.scoped.findMany<AgentToolPolicy>('agentToolPolicy', {
        where: { toolName },
        take: 1,
      })
    )[0];
    const from = existing ? modeToPolicy(existing.policy) : tool.policy;
    const target = policyToMode(policy);

    const saved = existing
      ? await this.scoped.updateById<AgentToolPolicy>('agentToolPolicy', existing.id, {
          policy: target,
          updatedByUserId: userId,
        })
      : await this.scoped.create<AgentToolPolicy>('agentToolPolicy', {
          toolName,
          policy: target,
          updatedByUserId: userId,
        });
    if (!saved) throw new NotFoundException(`Unknown tool: ${toolName}`);

    await this.audit.record('agent.policy.update', 'AgentToolPolicy', saved.id, {
      toolName,
      from,
      to: policy,
      sensitive: tool.sensitive,
      changedByRole: role,
    });

    const row = await this.scoped.findById<PolicyRow>('agentToolPolicy', saved.id, {
      include: POLICY_INCLUDE,
    });
    return this.toView(tool, row ?? undefined);
  }

  private toView(tool: AgentTool, row?: PolicyRow): AgentPolicyView {
    const effective: ToolPolicy = tool.readOnly
      ? 'auto'
      : row
        ? modeToPolicy(row.policy)
        : tool.policy;
    return {
      id: row?.id ?? null,
      toolName: tool.name,
      description: tool.description,
      permission: tool.permission,
      readOnly: tool.readOnly,
      sensitive: tool.sensitive,
      configurable: !tool.readOnly,
      defaultPolicy: tool.policy,
      policy: effective,
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ?? null,
    };
  }

  private async requirePolicyManager(): Promise<{ role: Role }> {
    const membership = await this.tenant.get();
    const role = membership.role as Role;
    if (!hasPermission(role, 'agent:policy')) {
      throw new ForbiddenException('Owner or Admin policy access is required');
    }
    if (!this.tenant.userId()) throw new UnauthorizedException();
    return { role };
  }
}
