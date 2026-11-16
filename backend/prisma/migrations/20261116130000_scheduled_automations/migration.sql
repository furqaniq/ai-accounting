-- CreateEnum
CREATE TYPE "AgentAutomationMode" AS ENUM ('CRON', 'EVENT');

-- CreateTable
CREATE TABLE "AgentAutomation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "AgentAutomationMode" NOT NULL DEFAULT 'CRON',
    "cron" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "prompt" TEXT NOT NULL,
    "model" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "lastStatus" "AgentJobStatus",
    "lastJobId" TEXT,
    "lastLogReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentAutomation_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "AgentJob" ADD COLUMN "automationId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AgentAutomation_organizationId_name_key" ON "AgentAutomation"("organizationId", "name");

-- CreateIndex
CREATE INDEX "AgentAutomation_organizationId_enabled_idx" ON "AgentAutomation"("organizationId", "enabled");

-- CreateIndex
CREATE INDEX "AgentAutomation_organizationId_createdAt_idx" ON "AgentAutomation"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentJob_organizationId_automationId_idx" ON "AgentJob"("organizationId", "automationId");

-- AddForeignKey
ALTER TABLE "AgentAutomation" ADD CONSTRAINT "AgentAutomation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAutomation" ADD CONSTRAINT "AgentAutomation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentJob" ADD CONSTRAINT "AgentJob_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "AgentAutomation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
