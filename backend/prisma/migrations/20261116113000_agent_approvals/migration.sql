-- CreateEnum
CREATE TYPE "AgentProposalStatus" AS ENUM ('PENDING', 'EXECUTING', 'EXECUTED', 'REJECTED', 'FAILED');

-- CreateTable
CREATE TABLE "AgentProposal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "jobId" TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "rationale" TEXT,
    "status" "AgentProposalStatus" NOT NULL DEFAULT 'PENDING',
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "result" JSONB,
    "error" TEXT,
    "logReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentProposal_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "AgentActionLog" ADD COLUMN "proposalId" TEXT,
ADD COLUMN "approvalStatus" "AgentProposalStatus";

-- CreateIndex
CREATE INDEX "AgentProposal_organizationId_status_createdAt_idx" ON "AgentProposal"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AgentProposal_organizationId_jobId_idx" ON "AgentProposal"("organizationId", "jobId");

-- CreateIndex
CREATE INDEX "AgentActionLog_organizationId_proposalId_idx" ON "AgentActionLog"("organizationId", "proposalId");

-- AddForeignKey
ALTER TABLE "AgentProposal" ADD CONSTRAINT "AgentProposal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentProposal" ADD CONSTRAINT "AgentProposal_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "AgentJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentProposal" ADD CONSTRAINT "AgentProposal_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentProposal" ADD CONSTRAINT "AgentProposal_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
