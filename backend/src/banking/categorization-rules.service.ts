import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Account, CategorizationRule, Prisma } from '@prisma/client';
import { AuditService } from '../tenant/audit.service';
import { ScopedDataAccess } from '../tenant/scoped-data-access.service';
import {
  CreateCategorizationRuleDto,
  UpdateCategorizationRuleDto,
} from './categorization-rule.dto';

const RULE_INCLUDE = {
  targetAccount: { select: { id: true, code: true, name: true, type: true } },
} as const;

type RuleRow = Prisma.CategorizationRuleGetPayload<{ include: typeof RULE_INCLUDE }>;

export interface CategorizationRuleView {
  id: string;
  descriptionContains: string;
  targetAccountId: string;
  targetAccount: { id: string; code: string; name: string; type: string };
  priority: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class CategorizationRulesService {
  constructor(
    private readonly scoped: ScopedDataAccess,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<CategorizationRuleView[]> {
    const rows = await this.scoped.findMany<RuleRow>('categorizationRule', {
      orderBy: [{ active: 'desc' }, { priority: 'asc' }, { createdAt: 'asc' }],
      include: RULE_INCLUDE,
    });
    return rows.map((row) => this.toView(row));
  }

  async create(input: CreateCategorizationRuleDto): Promise<CategorizationRuleView> {
    const descriptionContains = this.matchText(input.descriptionContains);
    const target = await this.resolveTarget(input.targetAccountId);
    const created = await this.scoped.create<CategorizationRule>('categorizationRule', {
      descriptionContains,
      targetAccountId: target.id,
      priority: input.priority ?? 100,
      active: input.active ?? true,
    });
    const row = await this.findRow(created.id);
    await this.audit.record('bank.rule.create', 'CategorizationRule', row.id, {
      descriptionContains,
      targetAccount: `${target.code} ${target.name}`,
      priority: row.priority,
    });
    return this.toView(row);
  }

  async update(id: string, input: UpdateCategorizationRuleDto): Promise<CategorizationRuleView> {
    const current = await this.findRow(id);
    const data: Record<string, unknown> = {};
    if (input.descriptionContains !== undefined) {
      data.descriptionContains = this.matchText(input.descriptionContains);
    }
    if (input.targetAccountId !== undefined) {
      const target = await this.resolveTarget(input.targetAccountId);
      data.targetAccountId = target.id;
    }
    if (input.priority !== undefined) data.priority = input.priority;
    if (input.active !== undefined) data.active = input.active;

    const updated = await this.scoped.updateById<CategorizationRule>('categorizationRule', id, data);
    if (!updated) throw new NotFoundException('Categorization rule not found');
    const row = await this.findRow(id);
    await this.audit.record('bank.rule.update', 'CategorizationRule', id, {
      before: {
        descriptionContains: current.descriptionContains,
        targetAccount: `${current.targetAccount.code} ${current.targetAccount.name}`,
        priority: current.priority,
        active: current.active,
      },
      after: {
        descriptionContains: row.descriptionContains,
        targetAccount: `${row.targetAccount.code} ${row.targetAccount.name}`,
        priority: row.priority,
        active: row.active,
      },
    });
    return this.toView(row);
  }

  async remove(id: string): Promise<void> {
    const current = await this.findRow(id);
    const deleted = await this.scoped.deleteById('categorizationRule', id);
    if (!deleted) throw new NotFoundException('Categorization rule not found');
    await this.audit.record('bank.rule.delete', 'CategorizationRule', id, {
      descriptionContains: current.descriptionContains,
      targetAccount: `${current.targetAccount.code} ${current.targetAccount.name}`,
      priority: current.priority,
      active: current.active,
    });
  }

  private matchText(value: string): string {
    const text = value.trim();
    if (!text) throw new BadRequestException('Choose the text a description must contain');
    return text;
  }

  private async resolveTarget(
    id: string,
  ): Promise<Pick<Account, 'id' | 'code' | 'name' | 'active'>> {
    const account = await this.scoped.findById<Account>('account', id, {
      select: { id: true, code: true, name: true, active: true },
    });
    if (!account) throw new NotFoundException('Target account not found');
    if (!account.active) throw new BadRequestException('Choose an active target account');
    return account;
  }

  private async findRow(id: string): Promise<RuleRow> {
    const row = await this.scoped.findById<RuleRow>('categorizationRule', id, {
      include: RULE_INCLUDE,
    });
    if (!row) throw new NotFoundException('Categorization rule not found');
    return row;
  }

  private toView(row: RuleRow): CategorizationRuleView {
    return {
      id: row.id,
      descriptionContains: row.descriptionContains,
      targetAccountId: row.targetAccountId,
      targetAccount: row.targetAccount,
      priority: row.priority,
      active: row.active,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
