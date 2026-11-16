-- CreateEnum
CREATE TYPE "AgentDomainEventType" AS ENUM ('BANK_TRANSACTION_IMPORTED', 'INVOICE_OVERDUE', 'BILL_OPENED', 'RECONCILIATION_DISCREPANCY');

-- AlterTable
ALTER TABLE "AgentAutomation" ALTER COLUMN "cron" DROP NOT NULL,
ADD COLUMN "eventType" "AgentDomainEventType",
ADD COLUMN "eventConfig" JSONB;

-- CreateIndex
CREATE INDEX "AgentAutomation_organizationId_mode_eventType_enabled_idx" ON "AgentAutomation"("organizationId", "mode", "eventType", "enabled");
