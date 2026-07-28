-- Additive migration: per-band Minimum MDR on brand rate cards.
-- minMdrValue is the lowest MDR the company will offer downstream (vendor cost
-- plus the company's guaranteed margin); a scheme POS service charge can never
-- be set below it, so the company never books a loss. minMdrValueT0 applies to
-- instant (T+0) settlement and falls back to minMdrValue when zero/unset.
-- Safe to apply while the app is running (defaults to 0, no row locks).

ALTER TABLE "BrandMdrRate"
  ADD COLUMN IF NOT EXISTS "minMdrValue" DECIMAL(14, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "minMdrValueT0" DECIMAL(14, 4) NOT NULL DEFAULT 0;
