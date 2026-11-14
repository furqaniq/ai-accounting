/*
  Warnings:

  - Added the required column `updatedAt` to the `Organization` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "baseCurrency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN     "defaultTaxRate" DECIMAL(5,4) NOT NULL DEFAULT 0,
ADD COLUMN     "fiscalYearStartDay" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "fiscalYearStartMonth" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
