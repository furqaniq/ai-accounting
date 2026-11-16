import { BadRequestException, Injectable } from '@nestjs/common';
import { AgentJob, AgentJobStatus, Role } from '@prisma/client';
import { AgentLogService } from './agent-log.service';
import { AiProviderService } from './ai-provider.service';
import { resolveAgentModel } from './model-catalog';
import { AgentToolResult } from './provider.types';
import { ToolRegistry } from './tool-registry';

const MAX_ROUNDS = 3;
const MAX_TOOL_CALLS = 3;

export interface AgentRunResult {
  response: string;
  toolNames: string[];
  logReference: string;
}

@Injectable()
export class AgentOrchestrator {
  constructor(
    private readonly provider: AiProviderService,
    private readonly registry: ToolRegistry,
    private readonly logs: AgentLogService,
  ) {}

  async run(job: AgentJob): Promise<AgentRunResult> {
    const role = job.role as Role;
    const declarations = this.registry.declarationsForRole(role);
    const modelId = resolveAgentModel(job.model).modelId;
    const toolResults: AgentToolResult[] = [];
    const toolNames: string[] = [];
    let response = '';

    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const turn = await this.provider.callWithTools({
        prompt: job.prompt,
        model: modelId,
        tools: declarations,
        attempt: Math.max(job.attempts, 1),
        toolResults: toolResults.length > 0 ? toolResults : undefined,
      });

      const calls = (turn.toolCalls ?? []).slice(
        0,
        Math.max(MAX_TOOL_CALLS - toolNames.length, 0),
      );

      if (calls.length === 0) {
        response = (turn.text ?? '').trim();
        break;
      }

      for (const call of calls) {
        const rawArgs =
          call.args && typeof call.args === 'object'
            ? (call.args as Record<string, unknown>)
            : {};
        try {
          const execution = await this.registry.execute(call.name, role, rawArgs);
          toolNames.push(execution.tool);
          toolResults.push({
            name: execution.tool,
            args: execution.args,
            result: execution.result,
          });
          await this.logs.append({
            trigger: job.trigger,
            status: AgentJobStatus.COMPLETED,
            model: job.model,
            toolNames: [execution.tool],
            input: execution.args,
            output: execution.result,
            jobId: job.id,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Tool failed';
          await this.logs.append({
            trigger: job.trigger,
            status: AgentJobStatus.FAILED,
            model: job.model,
            toolNames: [call.name],
            input: rawArgs,
            error: message,
            jobId: job.id,
          });
          throw new BadRequestException(message);
        }
      }

      if (toolNames.length >= MAX_TOOL_CALLS) {
        response = '';
        break;
      }
    }

    if (!response) {
      response =
        toolNames.length > 0
          ? `Completed ${toolNames.join(', ')} for this request.`
          : 'I could not produce a response for that request.';
    }

    const finalLog = await this.logs.append({
      trigger: job.trigger,
      status: AgentJobStatus.COMPLETED,
      model: job.model,
      toolNames,
      output: { response },
      jobId: job.id,
    });

    return {
      response,
      toolNames,
      logReference: finalLog.logReference,
    };
  }
}
