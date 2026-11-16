import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AgentJob } from '@prisma/client';
import { RequirePermission } from '../tenant/require-permission.decorator';
import { AgentJobsService, toAgentJobView } from './agent-jobs.service';
import { AgentLogService } from './agent-log.service';
import { AgentPolicyService } from './agent-policy.service';
import { AgentQueueService } from './agent-queue.service';
import { ApprovalService } from './approval.service';
import {
  AgentApprovalQueryDto,
  AgentLogQueryDto,
  CreateAgentPromptDto,
  RejectAgentProposalDto,
  UpdateAgentPolicyDto,
} from './agent.dto';

@Controller('agent')
export class AgentController {
  constructor(
    private readonly jobs: AgentJobsService,
    private readonly logs: AgentLogService,
    private readonly queue: AgentQueueService,
    private readonly approvals: ApprovalService,
    private readonly policies: AgentPolicyService,
  ) {}

  @Post('prompts')
  @HttpCode(202)
  @RequirePermission('agent:read')
  async submit(@Body() dto: CreateAgentPromptDto): Promise<{
    jobId: string;
    status: string;
    logReference: string;
  }> {
    const { job, logReference } = await this.jobs.create({
      prompt: dto.prompt.trim(),
      modelAlias: dto.model,
    });
    await this.queue.enqueue({
      jobId: job.id,
      organizationId: job.organizationId,
      userId: job.userId,
    });
    return { jobId: job.id, status: job.status, logReference };
  }

  @Get('jobs/:id')
  @RequirePermission('agent:read')
  async job(@Param('id') id: string): Promise<Record<string, unknown>> {
    const job = await this.jobs.find(id);
    const logs = await this.logs.list({ jobId: job.id, limit: 200 });
    const proposals = await this.approvals.listForJob(job.id);
    return { ...toAgentJobView(job), logs, proposals };
  }

  @Get('approvals')
  @RequirePermission('agent:read')
  async listApprovals(
    @Query() query: AgentApprovalQueryDto,
  ): Promise<{ approvals: unknown[] }> {
    return {
      approvals: await this.approvals.list({
        status: query.status,
        jobId: query.jobId,
        limit: query.limit,
      }),
    };
  }

  @Get('approvals/:id')
  @RequirePermission('agent:read')
  approval(@Param('id') id: string): Promise<unknown> {
    return this.approvals.find(id);
  }

  @Post('approvals/:id/approve')
  @HttpCode(200)
  @RequirePermission('agent:approve')
  approve(@Param('id') id: string): Promise<unknown> {
    return this.approvals.approve(id);
  }

  @Post('approvals/:id/reject')
  @HttpCode(200)
  @RequirePermission('agent:approve')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectAgentProposalDto,
  ): Promise<unknown> {
    return this.approvals.reject(id, dto?.reason);
  }

  @Get('policies')
  @RequirePermission('agent:policy')
  async listPolicies(): Promise<{ policies: unknown[] }> {
    return { policies: await this.policies.list() };
  }

  @Patch('policies/:toolName')
  @RequirePermission('agent:policy')
  updatePolicy(
    @Param('toolName') toolName: string,
    @Body() dto: UpdateAgentPolicyDto,
  ): Promise<unknown> {
    return this.policies.update(toolName, dto.policy);
  }

  @Get('logs')
  @RequirePermission('agent:read')
  async listLogs(@Query() query: AgentLogQueryDto): Promise<{ logs: unknown[] }> {
    return {
      logs: await this.logs.list({
        trigger: query.trigger,
        status: query.status,
        jobId: query.jobId,
        limit: query.limit,
      }),
    };
  }

  @Get('logs/:id')
  @RequirePermission('agent:read')
  log(@Param('id') id: string): Promise<unknown> {
    return this.logs.find(id);
  }

  @Post('test/jobs/:id/advance')
  @HttpCode(200)
  @RequirePermission('agent:read')
  async advance(@Param('id') id: string): Promise<Record<string, unknown>> {
    if (process.env.AGENT_TEST_HOOKS !== '1') {
      throw new NotFoundException();
    }
    const before = await this.jobs.find(id);
    const advanced = await this.queue.advance(id);
    const job: AgentJob = await this.jobs.find(id);
    return {
      jobId: id,
      advanced,
      status: job.status,
      previousStatus: before.status,
    };
  }
}
