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

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function automationIntent(prompt: string): boolean {
  const recurring =
    /\bautomation\b/i.test(prompt) ||
    /\b(every|each)\s+(day|weekday|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(
      prompt,
    );
  const action = /\b(create|add|set up|setup|schedule|propose|make|run)\b/i.test(prompt);
  return recurring && action;
}

function automationCron(prompt: string): string {
  const lower = prompt.toLowerCase();
  let hour = 9;
  let minute = 0;
  const at = lower.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (at) {
    hour = Number.parseInt(at[1], 10);
    minute = at[2] ? Number.parseInt(at[2], 10) : 0;
    if (at[3] === 'pm' && hour < 12) hour += 12;
    if (at[3] === 'am' && hour === 12) hour = 0;
  }
  hour = Math.min(Math.max(hour, 0), 23);
  minute = Math.min(Math.max(minute, 0), 59);

  const weekday = lower.match(
    /\b(?:every|each)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
  );
  if (weekday) {
    return `${minute} ${hour} * * ${WEEKDAY_INDEX[weekday[1]]}`;
  }
  if (/\b(?:every|each)\s+weekday\b/.test(lower)) {
    return `${minute} ${hour} * * 1-5`;
  }
  if (/\b(?:every|each)\s+week\b/.test(lower)) {
    return `${minute} ${hour} * * 1`;
  }
  return `${minute} ${hour} * * *`;
}

function automationName(prompt: string): string {
  const named = prompt.match(/\b(?:called|named)\s+"([^"]{1,80})"/i);
  if (named) return named[1].trim();
  return 'Recurring routine';
}

function automationProposal(prompt: string) {
  const cron = automationCron(prompt);
  const name = automationName(prompt);
  return {
    name: 'automation.create',
    args: { name, prompt, cron, timezone: 'UTC' },
    rationale: `Proposed a recurring routine “${name}” on cron ${cron} (UTC). An Owner or Admin must approve it before the schedule is registered.`,
  };
}

const EVENT_NAME = 'Event routine';

function eventAutomationIntent(prompt: string): boolean {
  const event =
    /\b(overdue|bill|bank transaction|reconciliation|discrepancy)\b/i.test(prompt);
  const trigger = /\bwhen\b/i.test(prompt);
  const action =
    /\b(create|add|set up|setup|propose|make|schedule|automate|run)\b/i.test(prompt);
  return event && trigger && action;
}

function amountAfterThreshold(prompt: string): number | undefined {
  const match = prompt.match(
    /(?:above|over|more than|at least)\s+\$?\s*([\d,]+(?:\.\d+)?)/i,
  );
  if (!match) return undefined;
  const value = Number.parseFloat(match[1].replace(/,/g, ''));
  return Number.isFinite(value) ? value : undefined;
}

function eventAutomationProposal(prompt: string) {
  const lower = prompt.toLowerCase();
  const name = automationName(prompt) === 'Recurring routine' ? EVENT_NAME : automationName(prompt);
  if (/overdue/.test(lower)) {
    const match = prompt.match(/(?:by|for|at least)\s+(\d+)\s+days?/i);
    const daysOverdue = match ? Number.parseInt(match[1], 10) : 0;
    return {
      name: 'automation.create',
      args: {
        name,
        prompt,
        mode: 'EVENT',
        eventType: 'INVOICE_OVERDUE',
        eventConfig: { daysOverdue },
      },
      rationale: `Proposed an event routine “${name}” that runs when an invoice is overdue${
        daysOverdue > 0 ? ` by at least ${daysOverdue} days` : ''
      }. An Owner or Admin must approve it before it is registered.`,
    };
  }
  if (/bill/.test(lower)) {
    const minAmount = amountAfterThreshold(prompt) ?? 0;
    return {
      name: 'automation.create',
      args: {
        name,
        prompt,
        mode: 'EVENT',
        eventType: 'BILL_OPENED',
        eventConfig: { minAmount },
      },
      rationale: `Proposed an event routine “${name}” that runs when a bill opens${
        minAmount > 0 ? ` above $${minAmount.toFixed(2)}` : ''
      }. An Owner or Admin must approve it before it is registered.`,
    };
  }
  if (/reconciliation|discrepancy/.test(lower)) {
    const minDifference = amountAfterThreshold(prompt) ?? 0;
    return {
      name: 'automation.create',
      args: {
        name,
        prompt,
        mode: 'EVENT',
        eventType: 'RECONCILIATION_DISCREPANCY',
        eventConfig: { minDifference },
      },
      rationale: `Proposed an event routine “${name}” that runs when a reconciliation has a discrepancy. An Owner or Admin must approve it before it is registered.`,
    };
  }
  return {
    name: 'automation.create',
    args: {
      name,
      prompt,
      mode: 'EVENT',
      eventType: 'BANK_TRANSACTION_IMPORTED',
      eventConfig: {},
    },
    rationale: `Proposed an event routine “${name}” that runs when a bank transaction is imported. An Owner or Admin must approve it before it is registered.`,
  };
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
  if (last.name === 'automation.create') {
    const name = typeof result.name === 'string' ? result.name : 'automation';
    const schedule =
      typeof result.scheduleLabel === 'string' ? ` ${result.scheduleLabel}` : '';
    return `Scheduled “${name}”${schedule}.`;
  }
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

    if (eventAutomationIntent(request.prompt)) {
      if (hasTool(request.tools, 'automation.create')) {
        return { toolCalls: [eventAutomationProposal(request.prompt)] };
      }
      return {
        text: 'This role cannot create automations. Owner, Admin, Accountant, or Staff access is required.',
      };
    }

    if (automationIntent(request.prompt)) {
      if (hasTool(request.tools, 'automation.create')) {
        return { toolCalls: [automationProposal(request.prompt)] };
      }
      return {
        text: 'This role cannot create automations. Owner, Admin, Accountant, or Staff access is required.',
      };
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
