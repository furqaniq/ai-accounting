import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { plainToInstance, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  validate,
} from 'class-validator';
import { Customer, Item, Role } from '@prisma/client';
import { ApAgingService } from '../purchases/ap-aging.service';
import { DashboardService } from '../reports/dashboard.service';
import { ReportsService } from '../reports/reports.service';
import { ArAgingService } from '../sales/ar-aging.service';
import { InvoicesService } from '../sales/invoices.service';
import { ScopedDataAccess } from '../tenant/scoped-data-access.service';
import { hasPermission, Permission } from '../tenant/permissions';
import { AgentToolDeclaration } from './provider.types';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SENSITIVE_KEY =
  /^(organization|organizationid|tenant|tenantid|orgid|sql|raw|code|script|query)$/i;

export const APPROVED_TOOL_TOKEN = Symbol('approved-agent-tool');

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
export type ToolPolicy = 'auto' | 'approve';

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

class InvoiceCreateLineArgs {
  @IsOptional()
  @IsString()
  itemId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  itemCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  itemName?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100000)
  quantity!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10000000)
  unitPrice?: number;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  description?: string;
}

class InvoiceCreateArgs {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  customerName?: string;

  @IsString()
  @Matches(DATE_PATTERN, { message: 'dueDate must be YYYY-MM-DD' })
  dueDate!: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'issueDate must be YYYY-MM-DD' })
  issueDate?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceCreateLineArgs)
  lines!: InvoiceCreateLineArgs[];

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1)
  taxRate?: number;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  notes?: string;
}

interface ToolDefinition {
  name: string;
  description: string;
  permission: Permission;
  readOnly: boolean;
  policy: ToolPolicy;
  dto: new () => object;
  parameters: Record<string, unknown>;
  prepareArgs?: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface AgentTool extends AgentToolDeclaration {
  permission: Permission;
  readOnly: boolean;
  policy: ToolPolicy;
}

export interface PreparedToolCall {
  tool: AgentTool;
  args: Record<string, unknown>;
}

const DATE_SCHEMA = {
  type: 'string',
  description: 'Calendar date in YYYY-MM-DD form (UTC).',
};

const INVOICE_LINE_SCHEMA = {
  type: 'object',
  properties: {
    itemId: { type: 'string', description: 'Existing item id.' },
    itemCode: { type: 'string', description: 'Existing item code, e.g. ITEM-0001.' },
    itemName: { type: 'string', description: 'Existing item name.' },
    quantity: { type: 'number' },
    unitPrice: { type: 'number', description: 'Defaults to the item price.' },
    description: { type: 'string' },
  },
  required: ['quantity'],
  additionalProperties: false,
};

/**
 * The single source of agent capabilities. Tools never receive a DB handle,
 * SQL, code evaluation, or an organization id: validation plus tenant-scoped
 * services are the entire blast radius. Write tools are routed through the
 * approval service, never executed by the orchestrator directly.
 */
@Injectable()
export class ToolRegistry {
  private readonly tools: ToolDefinition[];

  constructor(
    dashboardService: DashboardService,
    reports: ReportsService,
    arAging: ArAgingService,
    apAging: ApAgingService,
    private readonly invoices: InvoicesService,
    private readonly scoped: ScopedDataAccess,
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
      {
        name: 'invoice.create',
        description:
          'Propose a new DRAFT sales invoice. The invoice is created only after an Owner or Admin approves the proposal. Supply customerId or customerName and each line by itemId, itemCode, or itemName.',
        permission: 'invoices:manage',
        readOnly: false,
        policy: 'approve',
        dto: InvoiceCreateArgs,
        parameters: {
          type: 'object',
          properties: {
            customerId: { type: 'string', description: 'Existing customer id.' },
            customerName: { type: 'string', description: 'Existing customer name.' },
            dueDate: DATE_SCHEMA,
            issueDate: DATE_SCHEMA,
            lines: { type: 'array', items: INVOICE_LINE_SCHEMA },
            taxRate: { type: 'number' },
            notes: { type: 'string' },
          },
          required: ['dueDate', 'lines'],
          additionalProperties: false,
        },
        prepareArgs: async (args) =>
          this.prepareInvoiceCreate(args as unknown as InvoiceCreateArgs),
        handler: async (args) => {
          const input = args as unknown as InvoiceCreateArgs;
          const customer = input.customerId
            ? null
            : await this.resolveInvoiceCustomer(input);
          const lines = [];
          for (const line of input.lines) {
            const item = line.itemId ? null : await this.resolveInvoiceItem(line);
            lines.push({
              itemId: line.itemId ?? item!.id,
              quantity: line.quantity,
              ...(line.unitPrice !== undefined ? { unitPrice: line.unitPrice } : {}),
              ...(line.description ? { description: line.description } : {}),
            });
          }
          return this.invoices.create({
            customerId: input.customerId ?? customer!.id,
            dueDate: input.dueDate,
            issueDate: input.issueDate,
            lines,
            ...(input.taxRate !== undefined ? { taxRate: input.taxRate } : {}),
            ...(input.notes ? { notes: input.notes } : {}),
          });
        },
      },
    ];
  }

  listForRole(role: Role | string): AgentTool[] {
    return this.tools
      .filter((tool) => hasPermission(role, tool.permission))
      .map((tool) => this.toAgentTool(tool));
  }

  declarationsForRole(role: Role | string): AgentToolDeclaration[] {
    return this.listForRole(role).map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    }));
  }

  describe(name: string): AgentTool | undefined {
    const tool = this.find(name);
    return tool ? this.toAgentTool(tool) : undefined;
  }

  async execute(
    name: string,
    role: Role | string,
    rawArgs: Record<string, unknown> | undefined,
    options: { approvedToken?: symbol } = {},
  ): Promise<{ tool: string; result: unknown; args: Record<string, unknown> }> {
    const tool = this.find(name);
    if (!tool) {
      throw new BadRequestException(`Unknown tool: ${name}`);
    }
    if (!hasPermission(role, tool.permission)) {
      throw new ForbiddenException(`Tool ${name} is not available to this role`);
    }
    if (!tool.readOnly && options.approvedToken !== APPROVED_TOOL_TOKEN) {
      throw new ForbiddenException(
        `Tool ${name} requires approval and cannot execute directly`,
      );
    }
    const args = await this.prepare(tool, rawArgs);
    return { tool: tool.name, args, result: await tool.handler(args) };
  }

  /** The only path a write tool may execute through: used by the ApprovalService. */
  async executeApproved(
    name: string,
    role: Role | string,
    rawArgs: Record<string, unknown> | undefined,
  ): Promise<{ tool: string; result: unknown; args: Record<string, unknown> }> {
    return this.execute(name, role, rawArgs, { approvedToken: APPROVED_TOOL_TOKEN });
  }

  async prepareArguments(
    name: string,
    role: Role | string,
    rawArgs: Record<string, unknown> | undefined,
  ): Promise<PreparedToolCall> {
    const tool = this.find(name);
    if (!tool) {
      throw new BadRequestException(`Unknown tool: ${name}`);
    }
    if (!hasPermission(role, tool.permission)) {
      throw new ForbiddenException(`Tool ${name} is not available to this role`);
    }
    return {
      tool: this.toAgentTool(tool),
      args: await this.prepare(tool, rawArgs),
    };
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
    this.assertNoSensitiveKeys(rawArgs);
    if (Array.isArray((rawArgs as { lines?: unknown }).lines)) {
      for (const line of (rawArgs as { lines: unknown[] }).lines) {
        if (line && typeof line === 'object' && !Array.isArray(line)) {
          this.assertNoSensitiveKeys(line as Record<string, unknown>);
        }
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

  private async prepare(
    tool: ToolDefinition,
    rawArgs: Record<string, unknown> | undefined,
  ): Promise<Record<string, unknown>> {
    const input = await this.validateArguments(tool, rawArgs);
    return tool.prepareArgs ? tool.prepareArgs(input) : input;
  }

  private assertNoSensitiveKeys(value: Record<string, unknown>): void {
    for (const key of Object.keys(value)) {
      if (SENSITIVE_KEY.test(key)) {
        throw new BadRequestException(
          'Tool arguments may not include organization, SQL, query, or code fields',
        );
      }
    }
  }

  private async prepareInvoiceCreate(
    input: InvoiceCreateArgs,
  ): Promise<Record<string, unknown>> {
    const customer = await this.resolveInvoiceCustomer(input);
    const lines = [];
    for (const line of input.lines) {
      const item = await this.resolveInvoiceItem(line);
      lines.push({
        itemId: item.id,
        itemCode: item.code,
        itemName: item.name,
        quantity: line.quantity,
        ...(line.unitPrice !== undefined ? { unitPrice: line.unitPrice } : {}),
        ...(line.description ? { description: line.description } : {}),
      });
    }
    return {
      customerId: customer.id,
      customerName: customer.name,
      dueDate: input.dueDate,
      ...(input.issueDate ? { issueDate: input.issueDate } : {}),
      ...(input.taxRate !== undefined ? { taxRate: input.taxRate } : {}),
      ...(input.notes ? { notes: input.notes } : {}),
      lines,
    };
  }

  private async resolveInvoiceCustomer(
    input: InvoiceCreateArgs,
  ): Promise<Pick<Customer, 'id' | 'name' | 'active'>> {
    if (input.customerId) {
      const customer = await this.scoped.findById<Customer>('customer', input.customerId);
      if (!customer) {
        throw new BadRequestException('Customer must belong to this organization');
      }
      if (!customer.active) throw new BadRequestException('Customer is inactive');
      return customer;
    }
    if (!input.customerName?.trim()) {
      throw new BadRequestException('customerId or customerName is required');
    }
    const matches = await this.scoped.findMany<Customer>('customer', {
      where: { name: { equals: input.customerName.trim(), mode: 'insensitive' } },
    });
    const active = matches.filter((customer) => customer.active);
    if (active.length !== 1) {
      throw new BadRequestException(
        active.length === 0
          ? `No active customer named ${input.customerName}`
          : `Customer name ${input.customerName} is ambiguous`,
      );
    }
    return active[0];
  }

  private async resolveInvoiceItem(
    line: InvoiceCreateLineArgs,
  ): Promise<Pick<Item, 'id' | 'code' | 'name' | 'active'>> {
    if (line.itemId) {
      const item = await this.scoped.findById<Item>('item', line.itemId);
      if (!item) throw new BadRequestException('Item must belong to this organization');
      if (!item.active) throw new BadRequestException(`Item ${item.code} is inactive`);
      return item;
    }

    const identifier = line.itemCode ?? line.itemName;
    const field = line.itemCode ? 'code' : 'name';
    if (!identifier?.trim()) {
      throw new BadRequestException('itemId, itemCode, or itemName is required on every line');
    }
    const matches = await this.scoped.findMany<Item>('item', {
      where: { [field]: { equals: identifier.trim(), mode: 'insensitive' } },
    });
    const active = matches.filter((item) => item.active);
    if (active.length !== 1) {
      throw new BadRequestException(
        active.length === 0
          ? `No active item matches ${identifier}`
          : `Item ${identifier} is ambiguous`,
      );
    }
    return active[0];
  }

  private toAgentTool(tool: ToolDefinition): AgentTool {
    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      permission: tool.permission,
      readOnly: tool.readOnly,
      policy: tool.policy,
    };
  }

  private find(name: string): ToolDefinition | undefined {
    return this.tools.find((tool) => tool.name === name);
  }
}
