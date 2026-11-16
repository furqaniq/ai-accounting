import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AgentJob } from '@prisma/client';
import { DomainEventsService } from '../events/domain-events.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { RequirePermission } from '../tenant/require-permission.decorator';
import { AgentAutomationRunner } from './agent-automation-runner.service';
import { AgentAutomationService } from './agent-automation.service';
import { AgentJobsService, toAgentJobView } from './agent-jobs.service';
import { AgentLogService } from './agent-log.service';
import { AgentPolicyService } from './agent-policy.service';
import { AgentQueueService } from './agent-queue.service';
import { eventEntityType } from './domain-event.config';
import { ApprovalService } from './approval.service';
import {
  AgentApprovalQueryDto,
  AgentLogQueryDto,
  CreateAgentAutomationDto,
  CreateAgentPromptDto,
  FireDomainEventDto,
  RejectAgentProposalDto,
  UpdateAgentAutomationDto,
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
    private readonly automations: AgentAutomationService,
    private readonly automationRunner: AgentAutomationRunner,
    private readonly events: DomainEventsService,
    private readonly tenant: TenantContextService,
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

  @Get('automations')
  @RequirePermission('agent:read')
  async listAutomations(): Promise<{ automations: unknown[] }> {
    return { automations: await this.automations.list() };
  }

  @Get('automations/:id')
  @RequirePermission('agent:read')
  automation(@Param('id') id: string): Promise<unknown> {
    return this.automations.find(id);
  }

  @Post('automations')
  @RequirePermission('agent:manage')
  createAutomation(
    @Body() dto: CreateAgentAutomationDto,
  ): Promise<unknown> {
    return this.automations.create(dto);
  }

  @Patch('automations/:id')
  @RequirePermission('agent:manage')
  updateAutomation(
    @Param('id') id: string,
    @Body() dto: UpdateAgentAutomationDto,
  ): Promise<unknown> {
    return this.automations.update(id, dto);
  }

  @Delete('automations/:id')
  @RequirePermission('agent:manage')
  async deleteAutomation(
    @Param('id') id: string,
  ): Promise<{ deleted: boolean }> {
    await this.automations.remove(id);
    return { deleted: true };
  }

  @Post('test/automations/:id/run')
  @HttpCode(200)
  @RequirePermission('agent:manage')
  async runAutomationNow(
    @Param('id') id: string,
  ): Promise<{
    jobId: string | null;
    status: string | null;
    logReference: string | null;
  }> {
    if (process.env.AGENT_TEST_HOOKS !== '1') {
      throw new NotFoundException();
    }
    const automation = await this.automations.getRunnable(id);
    return this.automationRunner.runScheduled(automation.id, automation.organizationId);
  }

  @Post('test/events')
  @HttpCode(200)
  @RequirePermission('agent:manage')
  async fireDomainEvent(
    @Body() dto: FireDomainEventDto,
  ): Promise<{
    published: boolean;
    type: string;
    entityType: string;
    entityId: string;
    occurredAt: string;
  }> {
    if (process.env.AGENT_TEST_HOOKS !== '1') {
      throw new NotFoundException();
    }
    const { organizationId } = await this.tenant.get();
    const event = await this.events.publish({
      organizationId,
      type: dto.type,
      entityType: eventEntityType(dto.type),
      entityId: dto.entityId ?? `test-${Date.now()}`,
      data: dto.data,
    });
    return {
      published: true,
      type: event.type,
      entityType: event.entityType,
      entityId: event.entityId,
      occurredAt: event.occurredAt,
    };
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
