-- ============================================================
-- Migration: 20261106020000_knteer_beneficiary_owner
-- Description: Scope the Knteer beneficiary book per owner (userId) and drop
--              the global uniqueness on the partner referenceId (the partner
--              registers accounts at company level, so the same reference can
--              appear for multiple retailers).
--              Table is empty (feature never live) → safe to add NOT NULL.
-- ============================================================

-- Drop the old global unique on referenceId.
DROP INDEX IF EXISTS "knteer_beneficiaries_referenceId_key";

-- Drop the old display-only index (replaced by userId-scoped lookups).
DROP INDEX IF EXISTS "knteer_beneficiaries_accountLast4_idx";

-- Owner column + FK.
ALTER TABLE "knteer_beneficiaries"
  ADD COLUMN "userId" TEXT NOT NULL;

ALTER TABLE "knteer_beneficiaries"
  ADD CONSTRAINT "knteer_beneficiaries_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- One book entry per (owner, account last-4, IFSC).
CREATE UNIQUE INDEX "knteer_beneficiaries_userId_accountLast4_ifscCode_key"
  ON "knteer_beneficiaries"("userId", "accountLast4", "ifscCode");

CREATE INDEX "knteer_beneficiaries_userId_idx"
  ON "knteer_beneficiaries"("userId");
