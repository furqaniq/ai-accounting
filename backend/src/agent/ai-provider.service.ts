import { Injectable } from '@nestjs/common';
import {
  AiProvider,
  isRateLimitError,
  ProviderRequest,
  ProviderTurn,
  RetryableProviderError,
} from './provider.types';
import { GeminiProvider } from './providers/gemini.provider';
import { StubProvider } from './providers/stub.provider';

@Injectable()
export class AiProviderService {
  private readonly provider: AiProvider;
  readonly providerName: 'gemini' | 'stub';

  constructor() {
    const mode = (process.env.AI_PROVIDER ?? 'auto').toLowerCase();
    const key = process.env.GEMINI_API_KEY?.trim();
    const useGemini = mode === 'gemini' || (mode === 'auto' && Boolean(key));

    if (useGemini) {
      if (!key) {
        throw new Error('GEMINI_API_KEY is required when AI_PROVIDER=gemini');
      }
      this.provider = new GeminiProvider(key);
      this.providerName = 'gemini';
    } else {
      this.provider = new StubProvider();
      this.providerName = 'stub';
    }
  }

  async generate(request: ProviderRequest): Promise<string> {
    try {
      return await this.provider.generate(request);
    } catch (error) {
      throw this.normalize(error);
    }
  }

  async callWithTools(request: ProviderRequest): Promise<ProviderTurn> {
    try {
      return await this.provider.callWithTools(request);
    } catch (error) {
      throw this.normalize(error);
    }
  }

  private normalize(error: unknown): unknown {
    if (error instanceof RetryableProviderError) return error;
    if (isRateLimitError(error)) {
      const message = error instanceof Error ? error.message : 'Provider rate limited';
      return new RetryableProviderError(message, 429);
    }
    return error;
  }
}
