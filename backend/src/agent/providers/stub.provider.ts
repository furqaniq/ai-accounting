import {
  AgentToolDeclaration,
  AgentToolResult,
  AiProvider,
  ProviderRequest,
  ProviderTurn,
  RetryableProviderError,
} from '../provider.types';

const REPORT_PATTERNS: Array<{ slug: string; pattern: RegExp }> = [
  { slug: 'profit-loss', pattern: /profit|p&l|income statement/i },
  { slug: 'balance-sheet', pattern: /balance sheet/i },
  { slug: 'cash-flow', pattern: /cash flow/i },
  { slug: 'trial-balance', pattern: /trial balance/i },
  { slug: 'sales-by-customer', pattern: /sales by customer/i },
  { slug: 'sales-by-item', pattern: /sales by item/i },
  { slug: 'expenses-by-category', pattern: /expenses? by category/i },
  { slug: 'ar-aging', pattern: /ar aging|receivable aging/i },
  { slug: 'ap-aging', pattern: /ap aging|payable aging/i },
];

function reportSlug(prompt: string): string | undefined {
  return REPORT_PATTERNS.find((entry) => entry.pattern.test(prompt))?.slug;
}

function hasTool(tools: AgentToolDeclaration[], name: string): boolean {
  return tools.some((tool) => tool.name === name);
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function money(value: number): string {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function insightSummary(result: Record<string, unknown>): string {
  const cash = result.cash as { total?: number; accounts?: unknown[] } | undefined;
  const receivables = result.receivables as { total?: number } | undefined;
  const payables = result.payables as { total?: number } | undefined;
  const trend = result.trend as { netIncome?: number } | undefined;
  const period = result.period as { from?: string; to?: string } | undefined;

  const parts: string[] = [];
  if (number(cash?.total) !== null) {
    const count = Array.isArray(cash?.accounts) ? cash!.accounts!.length : 0;
    parts.push(`Cash across ${count} account${count === 1 ? '' : 's'} is ${money(cash!.total!)}`);
  }
  if (number(receivables?.total) !== null) {
    parts.push(`receivables are ${money(receivables!.total!)}`);
  }
  if (number(payables?.total) !== null) {
    parts.push(`payables are ${money(payables!.total!)}`);
  }
  if (number(trend?.netIncome) !== null) {
    parts.push(`net income for the period is ${money(trend!.netIncome!)}`);
  }
  const window =
    period?.from && period?.to ? ` (${period.from} to ${period.to})` : '';
  return `${parts.join(', ')}${window}.`;
}

function reportSummary(name: string, result: Record<string, unknown>): string {
  const period =
    typeof result.from === 'string' && typeof result.to === 'string'
      ? ` for ${result.from} to ${result.to}`
      : typeof result.asOf === 'string'
        ? ` as of ${result.asOf}`
        : '';
  const highlights: string[] = [];
  for (const key of [
    'netIncome',
    'totalIncome',
    'totalExpenses',
    'endingCash',
    'totalDebit',
    'totalAssets',
  ]) {
    const value = number(result[key]);
    if (value !== null) highlights.push(`${key} ${money(value)}`);
  }
  if (result.balanced === true) highlights.push('balanced');
  if (result.reconciled === true) highlights.push('reconciled');
  if (result.debitsEqualCredits === true) highlights.push('debits equal credits');
  const suffix = highlights.length > 0 ? `: ${highlights.join(', ')}` : '';
  return `The ${name} report${period} is ready${suffix}.`;
}

function finalText(toolResults: AgentToolResult[]): string {
  const last = toolResults[toolResults.length - 1];
  if (!last) return 'I could not find a permitted tool for that request.';
  if (last.error) return `The ${last.name} tool could not complete: ${last.error}`;
  const result = last.result as Record<string, unknown>;
  if (last.name === 'insight.query') return insightSummary(result);
  if (last.name === 'report.generate') {
    return reportSummary(String(result.report ?? 'requested'), result);
  }
  return `The ${last.name} tool completed.`;
}

/**
 * Deterministic local provider used by tests and by any deployment without a
 * Gemini key. It never touches the network.
 */
export class StubProvider implements AiProvider {
  async generate(request: ProviderRequest): Promise<string> {
    return `Stub response to: ${request.prompt.slice(0, 120)}`;
  }

  async callWithTools(request: ProviderRequest): Promise<ProviderTurn> {
    if (/\[429\]/i.test(request.prompt) && request.attempt <= 1) {
      throw new RetryableProviderError('Stub provider rate limit (429 RESOURCE_EXHAUSTED)');
    }

    if (request.toolResults && request.toolResults.length > 0) {
      return { text: finalText(request.toolResults) };
    }

    const slug = reportSlug(request.prompt);
    if (slug && hasTool(request.tools, 'report.generate')) {
      return {
        toolCalls: [{ name: 'report.generate', args: { report: slug } }],
      };
    }

    if (hasTool(request.tools, 'insight.query')) {
      return {
        toolCalls: [
          {
            name: 'insight.query',
            args: { question: request.prompt.slice(0, 1000) },
          },
        ],
      };
    }

    if (hasTool(request.tools, 'report.generate')) {
      return {
        toolCalls: [{ name: 'report.generate', args: { report: 'profit-loss' } }],
      };
    }

    return {
      text: 'No read-only tools are available to this role for that request.',
    };
  }
}
