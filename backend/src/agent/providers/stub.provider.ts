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

const SEED_CUSTOMERS = ['Northwind Studio', 'Harbor & Pine', 'Cedar Market'];
const SEED_ITEMS = ['Consulting hour', 'Design package', 'Support retainer'];

function seededName(prompt: string, options: string[], fallback: string): string {
  const lower = prompt.toLowerCase();
  return options.find((option) => lower.includes(option.toLowerCase())) ?? fallback;
}

function invoiceIntent(prompt: string): boolean {
  return /\binvoice\b/i.test(prompt) && /\b(create|make|draft|prepare|issue)\b/i.test(prompt);
}

function isoDueDate(prompt: string): { dueDate: string; days: number } {
  const match = prompt.match(/due\s+in\s+(\d+)\s+days?/i);
  const days = match ? Math.max(1, Number.parseInt(match[1], 10)) : 30;
  const date = new Date(Date.now() + days * 86_400_000);
  return { dueDate: date.toISOString().slice(0, 10), days };
}

function invoiceQuantity(prompt: string): number {
  const match =
    prompt.match(/\bfor\s+(\d+(?:\.\d+)?)\s+(?:hours?|units?|items?)\b/i) ??
    prompt.match(/\b(\d+(?:\.\d+)?)\s+(?:hours?|units?)\b/i);
  return match ? Number.parseFloat(match[1]) : 1;
}

function invoiceUnitPrice(prompt: string): number | undefined {
  const match =
    prompt.match(/\bat\s+\$?\s*([\d,]+(?:\.\d+)?)/i) ??
    prompt.match(/\$\s*([\d,]+(?:\.\d+)?)/);
  if (!match) return undefined;
  const value = Number.parseFloat(match[1].replace(/,/g, ''));
  return Number.isFinite(value) ? value : undefined;
}

function invoiceProposal(prompt: string) {
  const customerName = seededName(prompt, SEED_CUSTOMERS, 'Northwind Studio');
  const itemName = seededName(prompt, SEED_ITEMS, 'Consulting hour');
  const quantity = invoiceQuantity(prompt);
  const unitPrice = invoiceUnitPrice(prompt);
  const { dueDate, days } = isoDueDate(prompt);
  return {
    name: 'invoice.create',
    args: {
      customerName,
      dueDate,
      lines: [
        {
          itemName,
          quantity,
          ...(unitPrice !== undefined ? { unitPrice } : {}),
        },
      ],
    },
    rationale: `Proposed a draft invoice for ${customerName} for ${quantity} × ${itemName}${
      unitPrice !== undefined ? ` at $${unitPrice.toFixed(2)}` : ''
    }, due in ${days} days (${dueDate}). Nothing is posted until an Owner or Admin approves.`,
  };
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

    if (invoiceIntent(request.prompt)) {
      if (hasTool(request.tools, 'invoice.create')) {
        return { toolCalls: [invoiceProposal(request.prompt)] };
      }
      return {
        text: 'This role cannot propose invoices. Owner or Admin approval is required for write actions.',
      };
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
