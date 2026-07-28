-- Additive migration: per-tier T+0 (instant) commission on MDR slabs.
-- The existing commission columns are the T+1 (standard) commission; these
-- new *T0 columns apply to instant settlement and fall back to the T+1 value
-- when zero/unset (mirroring mdrValueT0 / vendorChargeT0).
-- Safe to apply while the app is running (defaults to 0, no row locks).

ALTER TABLE "MdrSlab"
  ADD COLUMN IF NOT EXISTS "commissionDistributorT0" DECIMAL(14, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "commissionMasterT0" DECIMAL(14, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "commissionSuperDistributorT0" DECIMAL(14, 4) NOT NULL DEFAULT 0;
