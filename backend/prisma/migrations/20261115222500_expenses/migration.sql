-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "vendorId" TEXT,
    "categoryAccountId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "memo" TEXT,
    "receiptNote" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Expense_organizationId_date_idx" ON "Expense"("organizationId", "date");

-- CreateIndex
CREATE INDEX "Expense_organizationId_vendorId_idx" ON "Expense"("organizationId", "vendorId");

-- CreateIndex
CREATE INDEX "Expense_organizationId_categoryAccountId_idx" ON "Expense"("organizationId", "categoryAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_organizationId_number_key" ON "Expense"("organizationId", "number");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryAccountId_fkey" FOREIGN KEY ("categoryAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
