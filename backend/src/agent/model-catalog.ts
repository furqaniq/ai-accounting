import { BadRequestException } from '@nestjs/common';

export interface ResolvedAgentModel {
  alias: string;
  modelId: string;
}

export function agentModelAliases(): Record<string, string> {
  return {
    flash: process.env.AGENT_MODEL_FLASH ?? 'gemini-2.5-flash',
    'flash-lite': process.env.AGENT_MODEL_FLASH_LITE ?? 'gemini-2.5-flash-lite',
    pro: process.env.AGENT_MODEL_PRO ?? 'gemini-2.5-pro',
  };
}

export function defaultAgentAlias(): string {
  const requested = (process.env.AGENT_DEFAULT_MODEL ?? 'flash').trim();
  return agentModelAliases()[requested] ? requested : 'flash';
}

export function resolveAgentModel(alias?: string): ResolvedAgentModel {
  const aliases = agentModelAliases();
  const requested = (alias ?? '').trim() || defaultAgentAlias();
  const modelId = aliases[requested];
  if (!modelId) {
    throw new BadRequestException(`Unknown model alias: ${requested}`);
  }
  return { alias: requested, modelId };
}
