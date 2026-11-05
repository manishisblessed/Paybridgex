-- ============================================================
-- Migration: 20261106010000_knteer_payout_rail
-- Description: Re-architect Bank Transfer (Knteer) to ride the shared
--              PayoutRequest money-safety lifecycle.
--                - Add KNTEER_PAYOUT to the ServiceCode enum (separate pricing)
--                - Add PayoutRequest.rail + PayoutRequest.knteerBeneficiaryId
--                - Drop the now-redundant knteer_payout_txns table
-- ============================================================

-- 1) New ServiceCode enum value for independent slab/brand pricing.
--    (PostgreSQL 12+ allows ADD VALUE inside a migration; the value is only
--     referenced by rows created later, never in this migration.)
ALTER TYPE "ServiceCode" ADD VALUE IF NOT EXISTS 'KNTEER_PAYOUT';

-- 2) PayoutRequest: disbursal rail + optional Knteer beneficiary link.
ALTER TABLE "PayoutRequest"
  ADD COLUMN "rail" TEXT NOT NULL DEFAULT 'SETTLEMENT';

ALTER TABLE "PayoutRequest"
  ADD COLUMN "knteerBeneficiaryId" TEXT;

-- FK → knteer_beneficiaries (nullable; SetNull on delete so a removed
-- beneficiary never orphans/deletes a payout ledger row).
ALTER TABLE "PayoutRequest"
  ADD CONSTRAINT "PayoutRequest_knteerBeneficiaryId_fkey"
  FOREIGN KEY ("knteerBeneficiaryId")
  REFERENCES "knteer_beneficiaries"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

-- Rail-scoped same-account cooldown + per-rail reporting index.
CREATE INDEX "PayoutRequest_userId_rail_accountLast4_status_createdAt_idx"
  ON "PayoutRequest"("userId", "rail", "accountLast4", "status", "createdAt");

-- 3) Drop the parallel Knteer ledger table — replaced by PayoutRequest rows
--    (rail = 'KNTEER'). Safe: feature was never live, table holds no data.
DROP TABLE IF EXISTS "knteer_payout_txns";
