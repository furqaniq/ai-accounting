import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  validate,
} from 'class-validator';
import { Role } from '@prisma/client';
import { ApAgingService } from '../purchases/ap-aging.service';
import { DashboardService } from '../reports/dashboard.service';
import { ReportsService } from '../reports/reports.service';
import { ArAgingService } from '../sales/ar-aging.service';
import { hasPermission, Permission } from '../tenant/permissions';
import { AgentToolDeclaration } from './provider.types';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SENSITIVE_KEY = /(organization|tenant|orgid|sql|raw|code|script|query)/i;

export const REPORT_SLUGS = [
  'profit-loss',
  'balance-sheet',
  'cash-flow',
  'trial-balance',
  'sales-by-customer',
  'sales-by-item',
  'expenses-by-category',
  'ar-aging',
  'ap-aging',
] as const;

export type ReportSlug = (typeof REPORT_SLUGS)[number];

class InsightQueryArgs {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  question!: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}

class ReportGenerateArgs {
  @IsIn([...REPORT_SLUGS])
  report!: ReportSlug;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'to must be YYYY-MM-DD' })
  to?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'asOf must be YYYY-MM-DD' })
  asOf?: string;
}

interface ToolDefinition {
  name: string;
  description: string;
  permission: Permission;
  readOnly: true;
  policy: 'auto';
  dto: new () => object;
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface AgentTool extends AgentToolDeclaration {
  permission: Permission;
  readOnly: boolean;
  policy: 'auto';
}

const DATE_SCHEMA = {
  type: 'string',
  description: 'Calendar date in YYYY-MM-DD form (UTC).',
};

/**
 * The single source of agent capabilities. Tools never receive a DB handle,
 * SQL, code evaluation, or an organization id: validation plus tenant-scoped
 * services are the entire blast radius.
 */
@Injectable()
export class ToolRegistry {
  private readonly tools: ToolDefinition[];

  constructor(
    dashboardService: DashboardService,
    reports: ReportsService,
    arAging: ArAgingService,
    apAging: ApAgingService,
  ) {
    this.tools = [
      {
        name: 'insight.query',
        description:
          'Read-only snapshot of the organization: cash, receivables, payables, income/expense trend, and attention counts. Use for natural-language questions about the books.',
        permission: 'reports:read',
        readOnly: true,
        policy: 'auto',
        dto: InsightQueryArgs,
        parameters: {
          type: 'object',
          properties: {
            question: {
              type: 'string',
              description: 'The user question, for traceability.',
            },
            from: DATE_SCHEMA,
            to: DATE_SCHEMA,
          },
          required: ['question'],
          additionalProperties: false,
        },
        handler: async (args) => {
          const input = args as unknown as InsightQueryArgs;
          const dashboard = await dashboardService.report({
            from: input.from,
            to: input.to,
          });
          return {
            question: input.question,
            period: { from: dashboard.from, to: dashboard.to },
            cash: dashboard.cash,
            receivables: dashboard.receivables,
            payables: dashboard.payables,
            trend: {
              totalIncome: dashboard.trend.totalIncome,
              totalExpenses: dashboard.trend.totalExpenses,
              netIncome: dashboard.trend.netIncome,
            },
            attention: dashboard.attention,
          };
        },
      },
      {
        name: 'report.generate',
        description:
          'Generate one read-only report: profit-loss, balance-sheet, cash-flow, trial-balance, sales-by-customer, sales-by-item, expenses-by-category, ar-aging, or ap-aging.',
        permission: 'reports:read',
        readOnly: true,
        policy: 'auto',
        dto: ReportGenerateArgs,
        parameters: {
          type: 'object',
          properties: {
            report: { type: 'string', enum: [...REPORT_SLUGS] },
            from: DATE_SCHEMA,
            to: DATE_SCHEMA,
            asOf: DATE_SCHEMA,
          },
          required: ['report'],
          additionalProperties: false,
        },
        handler: async (args) => {
          const input = args as unknown as ReportGenerateArgs;
          const period = { from: input.from, to: input.to };
          switch (input.report) {
            case 'profit-loss':
              return reports.profitLoss(period);
            case 'balance-sheet':
              return reports.balanceSheet({ asOf: input.asOf });
            case 'cash-flow':
              return reports.cashFlow(period);
            case 'trial-balance':
              return reports.trialBalance({ asOf: input.asOf });
            case 'sales-by-customer':
              return reports.salesByCustomer(period);
            case 'sales-by-item':
              return reports.salesByItem(period);
            case 'expenses-by-category':
              return reports.expensesByCategory(period);
            case 'ar-aging':
              return arAging.report(input.asOf);
            case 'ap-aging':
              return apAging.report(input.asOf);
            default:
              throw new BadRequestException('Unknown report');
          }
        },
      },
    ];
  }

  listForRole(role: Role | string): AgentTool[] {
    return this.tools
      .filter((tool) => hasPermission(role, tool.permission))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        permission: tool.permission,
        readOnly: tool.readOnly,
        policy: tool.policy,
      }));
  }

  declarationsForRole(role: Role | string): AgentToolDeclaration[] {
    return this.listForRole(role).map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    }));
  }

  async execute(
    name: string,
    role: Role | string,
    rawArgs: Record<string, unknown> | undefined,
  ): Promise<{ tool: string; result: unknown; args: Record<string, unknown> }> {
    const tool = this.find(name);
    if (!tool) {
      throw new BadRequestException(`Unknown tool: ${name}`);
    }
    if (!hasPermission(role, tool.permission)) {
      throw new ForbiddenException(`Tool ${name} is not available to this role`);
    }
    const args = await this.validateArguments(tool, rawArgs);
    return { tool: tool.name, args, result: await tool.handler(args) };
  }

  async validateArguments(
    nameOrTool: string | ToolDefinition,
    rawArgs: Record<string, unknown> | undefined,
  ): Promise<Record<string, unknown>> {
    const tool =
      typeof nameOrTool === 'string' ? this.find(nameOrTool) : nameOrTool;
    if (!tool) throw new BadRequestException('Unknown tool');

    if (rawArgs === undefined || rawArgs === null) {
      throw new BadRequestException('Tool arguments are required');
    }
    if (typeof rawArgs !== 'object' || Array.isArray(rawArgs)) {
      throw new BadRequestException('Tool arguments must be an object');
    }
    for (const key of Object.keys(rawArgs)) {
      if (SENSITIVE_KEY.test(key)) {
        throw new BadRequestException(
          'Tool arguments may not include organization, SQL, query, or code fields',
        );
      }
    }

    const instance = plainToInstance(tool.dto, rawArgs);
    const errors = await validate(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    });
    if (errors.length > 0) {
      const messages = errors.flatMap((entry) => Object.values(entry.constraints ?? {}));
      throw new BadRequestException(messages[0] ?? 'Invalid tool arguments');
    }
    return instance as Record<string, unknown>;
  }

  private find(name: string): ToolDefinition | undefined {
    return this.tools.find((tool) => tool.name === name);
  }
}
