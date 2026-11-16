import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DashboardService } from '../reports/dashboard.service';
import { ReportsService } from '../reports/reports.service';
import { ApAgingService } from '../purchases/ap-aging.service';
import { ArAgingService } from '../sales/ar-aging.service';
import { InvoicesService } from '../sales/invoices.service';
import { ScopedDataAccess } from '../tenant/scoped-data-access.service';
import { AgentAutomationService } from './agent-automation.service';
import { ToolRegistry } from './tool-registry';

interface FakeCustomer {
  id: string;
  name: string;
  active: boolean;
}

interface FakeItem {
  id: string;
  code: string;
  name: string;
  active: boolean;
}

interface RegistryOverrides {
  customers?: FakeCustomer[];
  items?: FakeItem[];
}

function registry(overrides: RegistryOverrides = {}): {
  tools: ToolRegistry;
  createInvoice: jest.Mock;
  createAutomation: jest.Mock;
} {
  const dashboard = {
    report: jest.fn(async () => ({
      from: '2026-01-01',
      to: '2026-12-31',
      cash: { total: 100, accounts: [] },
      receivables: { total: 0 },
      payables: { total: 0 },
      trend: { totalIncome: 0, totalExpenses: 0, netIncome: 0 },
      attention: {},
    })),
  } as unknown as DashboardService;
  const reports = {
    profitLoss: jest.fn(async () => ({ report: 'profit-loss' })),
  } as unknown as ReportsService;
  const ar = { report: jest.fn(async () => ({ report: 'ar-aging' })) } as unknown as ArAgingService;
  const ap = { report: jest.fn(async () => ({ report: 'ap-aging' })) } as unknown as ApAgingService;
  const createInvoice = jest.fn(async (dto: Record<string, unknown>) => ({
    id: 'invoice-1',
    number: 'INV-9001',
    status: 'DRAFT',
    ...dto,
  }));
  const invoices = { create: createInvoice } as unknown as InvoicesService;
  const createAutomation = jest.fn(async (dto: Record<string, unknown>) => ({
    id: 'automation-1',
    scheduleLabel: 'Every Monday at 9:00 AM',
    ...dto,
  }));
  const automations = {
    create: createAutomation,
  } as unknown as AgentAutomationService;

  const customers =
    overrides.customers ?? [
      { id: 'cust-1', name: 'Northwind Studio', active: true },
    ];
  const items =
    overrides.items ?? [
      { id: 'item-1', code: 'ITEM-0001', name: 'Consulting hour', active: true },
    ];

  const matches = (rows: Array<Record<string, unknown>>, where?: Record<string, unknown>) => {
    const filter = (where ?? {}) as {
      name?: { equals?: string };
      code?: { equals?: string };
    };
    return rows.filter((row) => {
      if (filter.name?.equals) {
        return String(row.name).toLowerCase() === filter.name.equals.toLowerCase();
      }
      if (filter.code?.equals) {
        return String(row.code).toLowerCase() === filter.code.equals.toLowerCase();
      }
      return true;
    });
  };

  const scoped = {
    findById: jest.fn(
      async (model: string, id: string) =>
        (model === 'customer' ? customers : items).find((row) => row.id === id) ?? null,
    ),
    findMany: jest.fn(async (model: string, args?: { where?: Record<string, unknown> }) =>
      matches(
        (model === 'customer' ? customers : items) as unknown as Array<Record<string, unknown>>,
        args?.where,
      ),
    ),
  } as unknown as ScopedDataAccess;

  return {
    tools: new ToolRegistry(dashboard, reports, ar, ap, invoices, scoped, automations),
    createInvoice,
    createAutomation,
  };
}

async function expectRejection(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(BadRequestException);
  await expect(promise).rejects.toThrow(pattern);
}

const invoiceArgs = {
  customerName: 'Northwind Studio',
  dueDate: '2026-12-31',
  lines: [{ itemName: 'Consulting hour', quantity: 1 }],
};

describe('ToolRegistry', () => {
  it('exposes read-only tools to viewers and the governed write tool to staff', () => {
    const viewerTools = registry().tools.listForRole('VIEWER');
    expect(viewerTools.map((tool) => tool.name).sort()).toEqual([
      'insight.query',
      'report.generate',
    ]);
    expect(
      viewerTools.every((tool) => tool.readOnly && !tool.sensitive && tool.policy === 'auto'),
    ).toBe(true);

    const staffTools = registry().tools.listForRole('STAFF');
    expect(staffTools.map((tool) => tool.name)).toContain('invoice.create');
    expect(staffTools.find((tool) => tool.name === 'invoice.create')).toMatchObject({
      readOnly: false,
      sensitive: true,
      policy: 'approve',
      permission: 'invoices:manage',
    });
    expect(staffTools.map((tool) => tool.name)).toContain('automation.create');
    expect(staffTools.find((tool) => tool.name === 'automation.create')).toMatchObject({
      readOnly: false,
      sensitive: true,
      policy: 'approve',
      permission: 'agent:manage',
    });
    expect(registry().tools.listForRole('NOPE')).toEqual([]);
  });

  it('exposes every registered tool for policy configuration', () => {
    const all = registry().tools.listAll();
    expect(all.map((tool) => tool.name).sort()).toEqual([
      'automation.create',
      'insight.query',
      'invoice.create',
      'report.generate',
    ]);
    expect(all.filter((tool) => !tool.readOnly).every((tool) => tool.sensitive)).toBe(true);
  });

  it('rejects unknown tools', async () => {
    await expectRejection(
      registry().tools.execute('sql.query', 'OWNER', { sql: 'select 1' }),
      /Unknown tool/,
    );
  });

  it('rejects organization and tenant injection', async () => {
    const { tools } = registry();
    await expectRejection(
      tools.execute('insight.query', 'OWNER', {
        question: 'cash?',
        organizationId: 'other-org',
      }),
      /organization/i,
    );
    await expectRejection(
      tools.execute('report.generate', 'OWNER', {
        report: 'profit-loss',
        tenantId: 'other-org',
      }),
      /organization|tenant/i,
    );
    await expectRejection(
      tools.prepareArguments('invoice.create', 'OWNER', {
        ...invoiceArgs,
        organizationId: 'other-org',
      }),
      /organization/i,
    );
    await expectRejection(
      tools.prepareArguments('invoice.create', 'OWNER', {
        ...invoiceArgs,
        lines: [{ itemName: 'Consulting hour', quantity: 1, code: 'x' }],
      }),
      /code/i,
    );
  });

  it('rejects SQL, query, and code arguments at the top level', async () => {
    const { tools } = registry();
    for (const key of ['sql', 'query', 'code', 'script']) {
      await expectRejection(
        tools.execute('insight.query', 'OWNER', { question: 'cash?', [key]: 'DROP TABLE x' }),
        /SQL|query|code/i,
      );
    }
  });

  it('validates required and unknown fields', async () => {
    const { tools } = registry();
    await expectRejection(tools.execute('insight.query', 'OWNER', {}), /question/);
    await expectRejection(
      tools.execute('insight.query', 'OWNER', { question: 'cash?', from: 'not-a-date' }),
      /YYYY-MM-DD/,
    );
    await expectRejection(
      tools.execute('insight.query', 'OWNER', { question: 'cash?', surprise: true }),
      /surprise/,
    );
    await expectRejection(
      tools.execute('report.generate', 'OWNER', { report: 'made-up' }),
      /report/,
    );
    await expectRejection(
      tools.prepareArguments('invoice.create', 'OWNER', {
        customerName: 'Northwind Studio',
        lines: [{ itemName: 'Consulting hour', quantity: 1 }],
      }),
      /dueDate/,
    );
  });

  it('executes a registered read-only tool with validated arguments', async () => {
    const result = await registry().tools.execute('insight.query', 'OWNER', {
      question: 'What is my cash?',
      from: '2026-01-01',
      to: '2026-12-31',
    });

    expect(result.tool).toBe('insight.query');
    expect(result.args).toMatchObject({ question: 'What is my cash?' });
    expect((result.result as { cash: { total: number } }).cash.total).toBe(100);
  });

  it('blocks a role without the tool permission', async () => {
    await expect(
      registry().tools.execute('insight.query', 'NOPE', { question: 'cash?' }),
    ).rejects.toThrow(/not available/);
  });

  it('refuses to execute a write tool without the internal approval token', async () => {
    await expect(
      registry().tools.execute('invoice.create', 'OWNER', invoiceArgs),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      registry().tools.execute('invoice.create', 'OWNER', invoiceArgs),
    ).rejects.toThrow(/requires approval/i);
  });

  it('prepares name-based invoice arguments into tenant ids', async () => {
    const prepared = await registry().tools.prepareArguments(
      'invoice.create',
      'OWNER',
      invoiceArgs,
    );
    expect(prepared.args).toMatchObject({
      customerId: 'cust-1',
      customerName: 'Northwind Studio',
      dueDate: '2026-12-31',
      lines: [
        {
          itemId: 'item-1',
          itemCode: 'ITEM-0001',
          itemName: 'Consulting hour',
          quantity: 1,
        },
      ],
    });
  });

  it('executes a prepared write tool exactly through the approved path', async () => {
    const { tools, createInvoice } = registry();
    const result = await tools.executeApproved('invoice.create', 'OWNER', invoiceArgs);

    expect(createInvoice).toHaveBeenCalledTimes(1);
    expect(createInvoice.mock.calls[0][0]).toMatchObject({
      customerId: 'cust-1',
      dueDate: '2026-12-31',
      lines: [{ itemId: 'item-1', quantity: 1 }],
    });
    expect(result.tool).toBe('invoice.create');
    expect((result.result as { id: string }).id).toBe('invoice-1');
  });

  it('validates and executes the governed automation.create tool', async () => {
    const { tools, createAutomation } = registry();

    await expect(
      tools.execute('automation.create', 'OWNER', {
        name: 'Weekly close',
        prompt: 'Summarize cash',
        cron: '0 9 * * 1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expectRejection(
      tools.prepareArguments('automation.create', 'OWNER', {
        name: 'Weekly close',
        prompt: 'Summarize cash',
        mode: 'WEEKLY',
      }),
      /CRON|EVENT|mode/i,
    );
    await expectRejection(
      tools.prepareArguments('automation.create', 'OWNER', {
        name: 'Weekly close',
        prompt: 'Summarize cash',
        cron: '0 9 * * 1',
        organizationId: 'other-org',
      }),
      /organization/i,
    );

    const prepared = await tools.prepareArguments('automation.create', 'OWNER', {
      name: 'Weekly close',
      prompt: 'Summarize cash',
      cron: '0 9 * * 1',
      timezone: 'America/New_York',
    });
    expect(prepared.args).toMatchObject({
      name: 'Weekly close',
      prompt: 'Summarize cash',
      cron: '0 9 * * 1',
      timezone: 'America/New_York',
    });

    const eventPrepared = await tools.prepareArguments('automation.create', 'OWNER', {
      name: 'Overdue review',
      prompt: 'Review overdue invoices',
      mode: 'EVENT',
      eventType: 'INVOICE_OVERDUE',
      eventConfig: { daysOverdue: 7 },
    });
    expect(eventPrepared.args).toMatchObject({
      name: 'Overdue review',
      mode: 'EVENT',
      eventType: 'INVOICE_OVERDUE',
      eventConfig: { daysOverdue: 7 },
    });

    const executed = await tools.executeApproved('automation.create', 'OWNER', {
      name: 'Weekly close',
      prompt: 'Summarize cash',
      cron: '0 9 * * 1',
    });
    expect(createAutomation).toHaveBeenCalledTimes(1);
    expect(executed.result).toMatchObject({ id: 'automation-1' });
  });

  it('rejects missing, inactive, and ambiguous customers and items', async () => {
    const missing = registry({ customers: [] }).tools;
    await expectRejection(
      missing.prepareArguments('invoice.create', 'OWNER', invoiceArgs),
      /No active customer/,
    );

    const inactive = registry({
      customers: [{ id: 'cust-1', name: 'Northwind Studio', active: false }],
    }).tools;
    await expectRejection(
      inactive.prepareArguments('invoice.create', 'OWNER', invoiceArgs),
      /No active customer|inactive/,
    );

    const ambiguous = registry({
      customers: [
        { id: 'cust-1', name: 'Northwind Studio', active: true },
        { id: 'cust-2', name: 'Northwind Studio', active: true },
      ],
    }).tools;
    await expectRejection(
      ambiguous.prepareArguments('invoice.create', 'OWNER', invoiceArgs),
      /ambiguous/,
    );

    const noItem = registry({ items: [] }).tools;
    await expectRejection(
      noItem.prepareArguments('invoice.create', 'OWNER', invoiceArgs),
      /No active item/,
    );
  });
});
