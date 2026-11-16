import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { AgentJob } from '@prisma/client';
import { RequirePermission } from '../tenant/require-permission.decorator';
import { AgentJobsService, toAgentJobView } from './agent-jobs.service';
import { AgentLogService } from './agent-log.service';
import { AgentQueueService } from './agent-queue.service';
import { AgentLogQueryDto, CreateAgentPromptDto } from './agent.dto';

@Controller('agent')
export class AgentController {
  constructor(
    private readonly jobs: AgentJobsService,
    private readonly logs: AgentLogService,
    private readonly queue: AgentQueueService,
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
    return { ...toAgentJobView(job), logs };
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
