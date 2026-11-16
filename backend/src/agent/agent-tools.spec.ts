import { BadRequestException } from '@nestjs/common';
import { DashboardService } from '../reports/dashboard.service';
import { ReportsService } from '../reports/reports.service';
import { ApAgingService } from '../purchases/ap-aging.service';
import { ArAgingService } from '../sales/ar-aging.service';
import { ToolRegistry } from './tool-registry';

function registry(): ToolRegistry {
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
  return new ToolRegistry(dashboard, reports, ar, ap);
}

async function expectRejection(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(BadRequestException);
  await expect(promise).rejects.toThrow(pattern);
}

describe('ToolRegistry', () => {
  it('exposes only read-only, role-permitted tools', () => {
    const tools = registry().listForRole('VIEWER');

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'insight.query',
      'report.generate',
    ]);
    expect(tools.every((tool) => tool.readOnly && tool.policy === 'auto')).toBe(true);
    expect(registry().listForRole('NOPE')).toEqual([]);
  });

  it('rejects unknown tools', async () => {
    await expectRejection(
      registry().execute('sql.query', 'OWNER', { sql: 'select 1' }),
      /Unknown tool/,
    );
  });

  it('rejects organization and tenant injection', async () => {
    const tools = registry();
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
  });

  it('rejects SQL, query, and code arguments', async () => {
    const tools = registry();
    for (const key of ['sql', 'query', 'code', 'script']) {
      await expectRejection(
        tools.execute('insight.query', 'OWNER', { question: 'cash?', [key]: 'DROP TABLE x' }),
        /SQL|query|code/i,
      );
    }
  });

  it('validates required and unknown fields', async () => {
    const tools = registry();
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
  });

  it('executes a registered read-only tool with validated arguments', async () => {
    const result = await registry().execute('insight.query', 'OWNER', {
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
      registry().execute('insight.query', 'NOPE', { question: 'cash?' }),
    ).rejects.toThrow(/not available/);
  });
});
