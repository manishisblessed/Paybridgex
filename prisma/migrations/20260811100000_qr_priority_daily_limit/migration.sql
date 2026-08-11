-- QR priority queue with per-QR daily collection caps.
-- Fully ADDITIVE, non-destructive: new columns default so existing rows keep
-- behaving as a single always-live QR (priority 100, unlimited, enabled).
--   - priority         → lower = retailers collect on it first
--   - dailyLimit        → max gross (non-rejected) claim value per IST day; NULL = unlimited
--   - dailyLimitCount   → optional cap on #claims per IST day; NULL = unlimited
--   - enabled           → admin master switch (only enabled QRs join the queue)
--   - autoPausedOn      → IST day-date the QR hit its cap; cleared automatically next day

-- AlterTable
ALTER TABLE "StaticQr" ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "StaticQr" ADD COLUMN     "dailyLimit" DECIMAL(14,2);
ALTER TABLE "StaticQr" ADD COLUMN     "dailyLimitCount" INTEGER;
ALTER TABLE "StaticQr" ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "StaticQr" ADD COLUMN     "autoPausedOn" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "StaticQr_enabled_priority_idx" ON "StaticQr"("enabled", "priority");
