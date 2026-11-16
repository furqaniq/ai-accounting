export interface AgentToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AgentToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface AgentToolResult {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  error?: string;
}

export interface ProviderRequest {
  prompt: string;
  model: string;
  tools: AgentToolDeclaration[];
  attempt: number;
  toolResults?: AgentToolResult[];
}

export interface ProviderTurn {
  text?: string;
  toolCalls?: AgentToolCall[];
}

export interface AiProvider {
  generate(request: ProviderRequest): Promise<string>;
  callWithTools(request: ProviderRequest): Promise<ProviderTurn>;
}

export class RetryableProviderError extends Error {
  readonly retryable = true;

  constructor(
    message: string,
    readonly status = 429,
  ) {
    super(message);
    this.name = 'RetryableProviderError';
  }
}

export function isRateLimitError(error: unknown): boolean {
  if (error instanceof RetryableProviderError) return true;
  const candidate = error as { status?: number; statusCode?: number; message?: string; code?: string };
  const status = candidate?.status ?? candidate?.statusCode;
  if (status === 429) return true;
  const message = `${candidate?.message ?? ''} ${candidate?.code ?? ''}`;
  return /RESOURCE_EXHAUSTED|rate limit|429/i.test(message);
}

export function shouldRetry(
  attempts: number,
  maxAttempts: number,
  retryable: boolean,
): boolean {
  return retryable && attempts < maxAttempts;
}
