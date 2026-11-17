import { BadRequestException } from '@nestjs/common';

export interface ResolvedAgentModel {
  alias: string;
  modelId: string;
}

export interface AgentModelOption extends ResolvedAgentModel {
  label: string;
  default: boolean;
}

const MODEL_LABELS: Record<string, string> = {
  flash: 'Flash',
  'flash-lite': 'Flash Lite',
  pro: 'Pro',
};

export function agentModelAliases(): Record<string, string> {
  return {
    flash: process.env.AGENT_MODEL_FLASH ?? 'gemini-3.1-flash-lite',
    'flash-lite': process.env.AGENT_MODEL_FLASH_LITE ?? 'gemini-3.1-flash-lite',
    pro: process.env.AGENT_MODEL_PRO ?? 'gemini-3.1-pro-preview',
  };
}

export function defaultAgentAlias(): string {
  const requested = (process.env.AGENT_DEFAULT_MODEL ?? 'flash').trim();
  return agentModelAliases()[requested] ? requested : 'flash';
}

export function agentModelCatalog(): AgentModelOption[] {
  const aliases = agentModelAliases();
  const fallback = defaultAgentAlias();
  return Object.entries(aliases).map(([alias, modelId]) => ({
    alias,
    label: MODEL_LABELS[alias] ?? alias,
    modelId,
    default: alias === fallback,
  }));
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
