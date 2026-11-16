-- CreateEnum
CREATE TYPE "AgentToolPolicyMode" AS ENUM ('AUTO', 'APPROVE');

-- CreateTable
CREATE TABLE "AgentToolPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "policy" "AgentToolPolicyMode" NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentToolPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentToolPolicy_organizationId_idx" ON "AgentToolPolicy"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentToolPolicy_organizationId_toolName_key" ON "AgentToolPolicy"("organizationId", "toolName");

-- AddForeignKey
ALTER TABLE "AgentToolPolicy" ADD CONSTRAINT "AgentToolPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentToolPolicy" ADD CONSTRAINT "AgentToolPolicy_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
