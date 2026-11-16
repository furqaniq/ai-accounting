-- CreateEnum
CREATE TYPE "AgentTrigger" AS ENUM ('PROMPT', 'CRON', 'EVENT');

-- CreateEnum
CREATE TYPE "AgentJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'RETRYING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "AgentJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "trigger" "AgentTrigger" NOT NULL DEFAULT 'PROMPT',
    "prompt" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" "AgentJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "response" TEXT,
    "error" TEXT,
    "toolNames" JSONB,
    "logReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentActionLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "trigger" "AgentTrigger" NOT NULL,
    "status" "AgentJobStatus" NOT NULL,
    "model" TEXT,
    "prompt" TEXT,
    "toolNames" JSONB,
    "input" JSONB,
    "output" JSONB,
    "error" TEXT,
    "jobId" TEXT,
    "logReference" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentActionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentJob_organizationId_createdAt_idx" ON "AgentJob"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentJob_organizationId_status_idx" ON "AgentJob"("organizationId", "status");

-- CreateIndex
CREATE INDEX "AgentActionLog_organizationId_createdAt_idx" ON "AgentActionLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentActionLog_organizationId_jobId_idx" ON "AgentActionLog"("organizationId", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentActionLog_organizationId_logReference_key" ON "AgentActionLog"("organizationId", "logReference");

-- AddForeignKey
ALTER TABLE "AgentJob" ADD CONSTRAINT "AgentJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentJob" ADD CONSTRAINT "AgentJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentActionLog" ADD CONSTRAINT "AgentActionLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentActionLog" ADD CONSTRAINT "AgentActionLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
