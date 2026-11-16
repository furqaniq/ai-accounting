import { Module } from '@nestjs/common';
import { PurchasesModule } from '../purchases/purchases.module';
import { ReportsModule } from '../reports/reports.module';
import { SalesModule } from '../sales/sales.module';
import { TenantModule } from '../tenant/tenant.module';
import { AgentController } from './agent.controller';
import { AgentJobsService } from './agent-jobs.service';
import { AgentLogService } from './agent-log.service';
import { AgentQueueService } from './agent-queue.service';
import { AgentRunnerService } from './agent-runner.service';
import { AiProviderService } from './ai-provider.service';
import { AgentOrchestrator } from './orchestrator.service';
import { ToolRegistry } from './tool-registry';

@Module({
  imports: [TenantModule, ReportsModule, SalesModule, PurchasesModule],
  controllers: [AgentController],
  providers: [
    AgentLogService,
    AgentJobsService,
    AiProviderService,
    ToolRegistry,
    AgentOrchestrator,
    AgentRunnerService,
    AgentQueueService,
  ],
})
export class AgentModule {}
