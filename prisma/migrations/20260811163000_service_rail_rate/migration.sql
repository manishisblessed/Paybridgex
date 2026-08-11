-- Service rails (BBPS & Payout) reuse the RailMdrRate rate card so each provider
-- can carry a Vendor cost + Minimum charge per transaction, mirroring PG/QR.
-- Extending the MdrServiceKind enum is additive; the new values are only USED by
-- rows inserted later (never within this migration), so it is transaction-safe.
ALTER TYPE "MdrServiceKind" ADD VALUE IF NOT EXISTS 'BBPS';
ALTER TYPE "MdrServiceKind" ADD VALUE IF NOT EXISTS 'PAYOUT';

-- Snapshot the locked vendor (upstream) cost on service scheme slabs (BBPS/Payout)
-- so company revenue per transaction = chargeValue − vendorCharge is auditable.
-- Defaults to 0 (no enforcement) so existing slabs keep working. Additive + safe
-- to apply while the app is running (no row locks, no backfill required).
ALTER TABLE "SchemeSlab"
  ADD COLUMN IF NOT EXISTS "vendorCharge" DECIMAL(14, 4) NOT NULL DEFAULT 0;
