import { BadRequestException } from '@nestjs/common';
import {
  agentModelAliases,
  agentModelCatalog,
  defaultAgentAlias,
  resolveAgentModel,
} from './model-catalog';
import {
  isRateLimitError,
  RetryableProviderError,
  shouldRetry,
} from './provider.types';
import { StubProvider } from './providers/stub.provider';
import { AiProviderService } from './ai-provider.service';
import { retryDelayMs } from './agent-queue.service';

const declarations = [
  {
    name: 'insight.query',
    description: 'snapshot',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'report.generate',
    description: 'report',
    parameters: { type: 'object', properties: {} },
  },
];

describe('agent model aliases', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it('builds a labelled catalog with one default alias', () => {
    delete process.env.AGENT_DEFAULT_MODEL;
    const catalog = agentModelCatalog();
    expect(catalog.map((entry) => entry.alias)).toEqual([
      'flash',
      'flash-lite',
      'pro',
    ]);
    expect(catalog.filter((entry) => entry.default).map((entry) => entry.alias)).toEqual([
      'flash',
    ]);
    expect(catalog.every((entry) => entry.label.length > 0 && entry.modelId.length > 0)).toBe(
      true,
    );
    expect(catalog.find((entry) => entry.alias === 'flash-lite')?.label).toBe('Flash Lite');
  });

  it('resolves the configured default alias', () => {
    delete process.env.AGENT_DEFAULT_MODEL;
    expect(defaultAgentAlias()).toBe('flash');
    expect(resolveAgentModel()).toEqual({
      alias: 'flash',
      modelId: agentModelAliases().flash,
    });
  });

  it('maps an explicit alias from the server-side allowlist', () => {
    process.env.AGENT_MODEL_PRO = 'gemini-2.5-pro-test';
    expect(resolveAgentModel('pro')).toEqual({
      alias: 'pro',
      modelId: 'gemini-2.5-pro-test',
    });
  });

  it('honors a configured default alias and rejects unknown aliases', () => {
    process.env.AGENT_DEFAULT_MODEL = 'flash-lite';
    expect(defaultAgentAlias()).toBe('flash-lite');
    expect(resolveAgentModel().alias).toBe('flash-lite');
    expect(() => resolveAgentModel('unlimited')).toThrow(BadRequestException);
  });
});

describe('provider rate-limit handling', () => {
  it('classifies Gemini 429 shapes and ignores ordinary errors', () => {
    expect(isRateLimitError({ status: 429 })).toBe(true);
    expect(isRateLimitError({ message: '429 RESOURCE_EXHAUSTED' })).toBe(true);
    expect(isRateLimitError({ status: 500, message: 'boom' })).toBe(false);
    expect(isRateLimitError(new Error('ordinary'))).toBe(false);
  });

  it('normalizes provider 429s inside AiProviderService', async () => {
    process.env.AI_PROVIDER = 'stub';
    const service = new AiProviderService();
    expect(service.providerName).toBe('stub');
    await expect(
      service.callWithTools({
        prompt: '[429] cash?',
        model: 'gemini-2.5-flash',
        tools: declarations,
        attempt: 1,
      }),
    ).rejects.toBeInstanceOf(RetryableProviderError);
  });

  it('lets the stub retry succeed on the next attempt', async () => {
    const stub = new StubProvider();
    await expect(
      stub.callWithTools({
        prompt: '[429] What is my cash position?',
        model: 'flash',
        tools: declarations,
        attempt: 1,
      }),
    ).rejects.toBeInstanceOf(RetryableProviderError);

    const turn = await stub.callWithTools({
      prompt: '[429] What is my cash position?',
      model: 'flash',
      tools: declarations,
      attempt: 2,
    });
    expect(turn.toolCalls?.[0]).toEqual({
      name: 'insight.query',
      args: { question: '[429] What is my cash position?' },
    });

    const final = await stub.callWithTools({
      prompt: '[429] What is my cash position?',
      model: 'flash',
      tools: declarations,
      attempt: 2,
      toolResults: [
        {
          name: 'insight.query',
          args: { question: 'cash?' },
          result: {
            cash: { total: 1234.5, accounts: [{}] },
            receivables: { total: 0 },
            payables: { total: 0 },
            trend: { netIncome: 10 },
          },
        },
      ],
    });
    expect(final.text).toContain('$1,234.50');
  });

  it('proposes a seeded draft invoice with a rationale for create-invoice prompts', async () => {
    const turn = await new StubProvider().callWithTools({
      prompt:
        'Create a draft invoice for Northwind Studio for 1 Consulting hour at $150, due in 30 days.',
      model: 'flash',
      tools: [
        ...declarations,
        {
          name: 'invoice.create',
          description: 'draft invoice',
          parameters: { type: 'object', properties: {} },
        },
      ],
      attempt: 1,
    });

    const call = turn.toolCalls?.[0];
    expect(call?.name).toBe('invoice.create');
    expect(call?.args).toMatchObject({
      customerName: 'Northwind Studio',
      lines: [{ itemName: 'Consulting hour', quantity: 1, unitPrice: 150 }],
    });
    expect((call?.args.dueDate as string)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(call?.rationale).toContain('Owner or Admin');
  });

  it('does not propose a write when the role has no invoice tool', async () => {
    const turn = await new StubProvider().callWithTools({
      prompt: 'Create a draft invoice for Northwind Studio.',
      model: 'flash',
      tools: declarations,
      attempt: 1,
    });
    expect(turn.toolCalls).toBeUndefined();
    expect(turn.text).toContain('Owner or Admin approval');
  });

  it('maps route-free report prompts to the report tool', async () => {
    const turn = await new StubProvider().callWithTools({
      prompt: 'Show me the profit and loss report',
      model: 'flash',
      tools: declarations,
      attempt: 1,
    });
    expect(turn.toolCalls?.[0]).toEqual({
      name: 'report.generate',
      args: { report: 'profit-loss' },
    });
  });
});

describe('queue retry semantics', () => {
  it('retries only retryable failures below the attempt cap', () => {
    expect(shouldRetry(1, 3, true)).toBe(true);
    expect(shouldRetry(3, 3, true)).toBe(false);
    expect(shouldRetry(1, 3, false)).toBe(false);
  });

  it('uses bounded exponential backoff with jitter', () => {
    expect(retryDelayMs(1)).toBeGreaterThanOrEqual(500);
    expect(retryDelayMs(1)).toBeLessThan(750);
    expect(retryDelayMs(20)).toBeGreaterThanOrEqual(30_000);
    expect(retryDelayMs(20)).toBeLessThan(30_250);
  });
});
