import { Module } from '@nestjs/common';
import { PurchasesModule } from '../purchases/purchases.module';
import { ReportsModule } from '../reports/reports.module';
import { SalesModule } from '../sales/sales.module';
import { TenantModule } from '../tenant/tenant.module';
import { AgentAutomationRunner } from './agent-automation-runner.service';
import { AgentAutomationScheduler } from './agent-automation-scheduler.service';
import { AgentAutomationService } from './agent-automation.service';
import { AgentAutomationWorker } from './agent-automation-worker.service';
import { AgentController } from './agent.controller';
import { AgentJobsService } from './agent-jobs.service';
import { AgentLogService } from './agent-log.service';
import { AgentPolicyService } from './agent-policy.service';
import { AgentQueueService } from './agent-queue.service';
import { AgentRunnerService } from './agent-runner.service';
import { AiProviderService } from './ai-provider.service';
import { ApprovalService } from './approval.service';
import { DomainEventRouter } from './domain-event-router.service';
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
    AgentPolicyService,
    ApprovalService,
    AgentOrchestrator,
    AgentRunnerService,
    AgentQueueService,
    AgentAutomationScheduler,
    AgentAutomationRunner,
    AgentAutomationService,
    AgentAutomationWorker,
    DomainEventRouter,
  ],
})
export class AgentModule {}
