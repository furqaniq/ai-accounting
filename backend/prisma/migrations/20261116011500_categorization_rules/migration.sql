-- AlterTable
ALTER TABLE "BankTransaction" ADD COLUMN     "categoryAccountId" TEXT,
ADD COLUMN     "categoryRuleId" TEXT;

-- CreateTable
CREATE TABLE "CategorizationRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "descriptionContains" TEXT NOT NULL,
    "targetAccountId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategorizationRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CategorizationRule_organizationId_active_priority_idx" ON "CategorizationRule"("organizationId", "active", "priority");

-- CreateIndex
CREATE INDEX "CategorizationRule_organizationId_targetAccountId_idx" ON "CategorizationRule"("organizationId", "targetAccountId");

-- CreateIndex
CREATE INDEX "BankTransaction_organizationId_categoryRuleId_idx" ON "BankTransaction"("organizationId", "categoryRuleId");

-- AddForeignKey
ALTER TABLE "CategorizationRule" ADD CONSTRAINT "CategorizationRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategorizationRule" ADD CONSTRAINT "CategorizationRule_targetAccountId_fkey" FOREIGN KEY ("targetAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_categoryAccountId_fkey" FOREIGN KEY ("categoryAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_categoryRuleId_fkey" FOREIGN KEY ("categoryRuleId") REFERENCES "CategorizationRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

