-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('ACTIVE', 'COMPLETED');

-- AlterTable
ALTER TABLE "BankTransaction" ADD COLUMN     "clearedAt" TIMESTAMP(3),
ADD COLUMN     "reconciliationSessionId" TEXT;

-- CreateTable
CREATE TABLE "ReconciliationSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "statementEndingBalance" DECIMAL(14,2) NOT NULL,
    "openingBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "clearedTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "bookBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "difference" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReconciliationSession_organizationId_bankAccountId_status_idx" ON "ReconciliationSession"("organizationId", "bankAccountId", "status");

-- CreateIndex
CREATE INDEX "ReconciliationSession_organizationId_periodEnd_idx" ON "ReconciliationSession"("organizationId", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationSession_organizationId_bankAccountId_periodSt_key" ON "ReconciliationSession"("organizationId", "bankAccountId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "BankTransaction_organizationId_reconciliationSessionId_idx" ON "BankTransaction"("organizationId", "reconciliationSessionId");

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_reconciliationSessionId_fkey" FOREIGN KEY ("reconciliationSessionId") REFERENCES "ReconciliationSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationSession" ADD CONSTRAINT "ReconciliationSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationSession" ADD CONSTRAINT "ReconciliationSession_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
