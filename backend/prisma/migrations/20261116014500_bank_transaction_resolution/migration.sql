-- AlterTable
ALTER TABLE "BankTransaction" ADD COLUMN     "matchedEntityId" TEXT,
ADD COLUMN     "matchedEntityType" TEXT,
ADD COLUMN     "resolutionLabel" TEXT,
ADD COLUMN     "resolvedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "BankTransaction_organizationId_matchedEntityType_matchedEnt_idx" ON "BankTransaction"("organizationId", "matchedEntityType", "matchedEntityId");

