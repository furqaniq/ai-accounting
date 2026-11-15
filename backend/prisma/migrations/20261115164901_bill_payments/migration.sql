-- CreateTable
CREATE TABLE "BillPayment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
    "reference" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillPaymentApplication" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "billPaymentId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillPaymentApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BillPayment_organizationId_date_idx" ON "BillPayment"("organizationId", "date");

-- CreateIndex
CREATE INDEX "BillPayment_organizationId_vendorId_idx" ON "BillPayment"("organizationId", "vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "BillPayment_organizationId_number_key" ON "BillPayment"("organizationId", "number");

-- CreateIndex
CREATE INDEX "BillPaymentApplication_organizationId_billPaymentId_idx" ON "BillPaymentApplication"("organizationId", "billPaymentId");

-- CreateIndex
CREATE INDEX "BillPaymentApplication_organizationId_billId_idx" ON "BillPaymentApplication"("organizationId", "billId");

-- CreateIndex
CREATE UNIQUE INDEX "BillPaymentApplication_billPaymentId_billId_key" ON "BillPaymentApplication"("billPaymentId", "billId");

-- AddForeignKey
ALTER TABLE "BillPayment" ADD CONSTRAINT "BillPayment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillPayment" ADD CONSTRAINT "BillPayment_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillPaymentApplication" ADD CONSTRAINT "BillPaymentApplication_billPaymentId_fkey" FOREIGN KEY ("billPaymentId") REFERENCES "BillPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillPaymentApplication" ADD CONSTRAINT "BillPaymentApplication_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
