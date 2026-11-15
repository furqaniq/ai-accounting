-- AlterTable
ALTER TABLE "ReconciliationSession" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "completedById" TEXT,
ADD COLUMN     "completionSnapshot" JSONB;
