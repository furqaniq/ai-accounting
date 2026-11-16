import {
  AiProvider,
  ProviderRequest,
  ProviderTurn,
  RetryableProviderError,
} from '../provider.types';

const GEMINI_BASE =
  process.env.GEMINI_API_BASE ?? 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
  error?: { status?: string; message?: string; code?: number };
}

function buildContents(request: ProviderRequest): unknown[] {
  const contents: unknown[] = [{ role: 'user', parts: [{ text: request.prompt }] }];
  for (const tool of request.toolResults ?? []) {
    contents.push({
      role: 'model',
      parts: [{ functionCall: { name: tool.name, args: tool.args } }],
    });
    contents.push({
      role: 'user',
      parts: [
        {
          functionResponse: {
            name: tool.name,
            response: tool.error ? { error: tool.error } : { result: tool.result },
          },
        },
      ],
    });
  }
  return contents;
}

/**
 * Gemini REST implementation. All Gemini-specific request/response shapes and
 * rate-limit classification live here and nowhere else.
 */
export class GeminiProvider implements AiProvider {
  constructor(private readonly apiKey: string) {}

  async generate(request: ProviderRequest): Promise<string> {
    const turn = await this.call(request, false);
    return turn.text ?? '';
  }

  async callWithTools(request: ProviderRequest): Promise<ProviderTurn> {
    return this.call(request, true);
  }

  private async call(request: ProviderRequest, withTools: boolean): Promise<ProviderTurn> {
    const body: Record<string, unknown> = {
      contents: buildContents(request),
      generationConfig: { temperature: 0.2 },
    };
    if (withTools && request.tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          })),
        },
      ];
    }

    const response = await fetch(
      `${GEMINI_BASE}/models/${encodeURIComponent(request.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    let payload: GeminiResponse = {};
    try {
      payload = (await response.json()) as GeminiResponse;
    } catch {
      payload = {};
    }

    if (!response.ok) {
      const message = payload.error?.message ?? `Gemini request failed (${response.status})`;
      if (
        response.status === 429 ||
        payload.error?.status === 'RESOURCE_EXHAUSTED' ||
        /RESOURCE_EXHAUSTED|429/i.test(message)
      ) {
        throw new RetryableProviderError(message, 429);
      }
      throw new Error(message);
    }

    const parts = payload.candidates?.[0]?.content?.parts ?? [];
    const text = parts
      .map((part) => part.text ?? '')
      .filter(Boolean)
      .join('\n')
      .trim();
    const toolCalls = parts
      .filter((part) => part.functionCall?.name)
      .map((part) => ({
        name: part.functionCall!.name,
        args: part.functionCall!.args ?? {},
        ...(text ? { rationale: text } : {}),
      }));

    return {
      text: text || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }
}
