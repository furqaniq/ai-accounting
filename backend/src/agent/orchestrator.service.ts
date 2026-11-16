import { BadRequestException, Injectable } from '@nestjs/common';
import { AgentJob, AgentJobStatus, Role } from '@prisma/client';
import { AgentLogService } from './agent-log.service';
import { AiProviderService } from './ai-provider.service';
import { ApprovalService } from './approval.service';
import { resolveAgentModel } from './model-catalog';
import { AgentToolResult } from './provider.types';
import { ToolRegistry } from './tool-registry';

const MAX_ROUNDS = 3;
const MAX_TOOL_CALLS = 3;
const MAX_WRITE_PROPOSALS = 1;

export interface AgentRunResult {
  response: string;
  toolNames: string[];
  logReference: string;
  proposalIds: string[];
}

@Injectable()
export class AgentOrchestrator {
  constructor(
    private readonly provider: AiProviderService,
    private readonly registry: ToolRegistry,
    private readonly logs: AgentLogService,
    private readonly approvals: ApprovalService,
  ) {}

  async run(job: AgentJob): Promise<AgentRunResult> {
    const role = job.role as Role;
    const declarations = this.registry.declarationsForRole(role);
    const modelId = resolveAgentModel(job.model).modelId;
    const toolResults: AgentToolResult[] = [];
    const toolNames: string[] = [];
    const proposalIds: string[] = [];
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

      let proposedWrite = false;
      for (const call of calls) {
        const rawArgs =
          call.args && typeof call.args === 'object'
            ? (call.args as Record<string, unknown>)
            : {};
        const tool = this.registry.describe(call.name);
        if (!tool) {
          await this.logFailure(job, call.name, rawArgs, `Unknown tool: ${call.name}`);
          throw new BadRequestException(`Unknown tool: ${call.name}`);
        }

        if (tool.policy === 'approve' || !tool.readOnly) {
          if (proposalIds.length >= MAX_WRITE_PROPOSALS) {
            continue;
          }
          try {
            const prepared = await this.registry.prepareArguments(
              call.name,
              role,
              rawArgs,
            );
            const proposal = await this.approvals.createProposal({
              job,
              toolName: prepared.tool.name,
              args: prepared.args,
              rationale: call.rationale ?? turn.text,
            });
            proposalIds.push(proposal.id);
            toolNames.push(prepared.tool.name);
            proposedWrite = true;
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Tool failed';
            await this.logFailure(job, call.name, rawArgs, message);
            throw new BadRequestException(message);
          }
          break;
        }

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
          await this.logFailure(job, call.name, rawArgs, message);
          throw new BadRequestException(message);
        }
      }

      if (proposedWrite) {
        response = `Prepared a write proposal (${toolNames[toolNames.length - 1]}) for approval. An Owner or Admin must approve it in the Approvals inbox before anything is executed.`;
        break;
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
      output: { response, proposalIds },
      jobId: job.id,
    });

    return {
      response,
      toolNames,
      logReference: finalLog.logReference,
      proposalIds,
    };
  }

  private async logFailure(
    job: AgentJob,
    toolName: string,
    args: Record<string, unknown>,
    message: string,
  ): Promise<void> {
    await this.logs.append({
      trigger: job.trigger,
      status: AgentJobStatus.FAILED,
      model: job.model,
      toolNames: [toolName],
      input: args,
      error: message,
      jobId: job.id,
    });
  }
}
