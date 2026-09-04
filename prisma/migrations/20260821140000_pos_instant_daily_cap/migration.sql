-- Additive migration: per-user POS instant-settlement daily cap.
-- Applied on top of the global instant pool (settlement.pos_instant.dailyLimitAmount);
-- the stricter of the two constrains a user's instant settlements per IST day.
-- NULL = only the global pool applies. Safe to apply while running (no row locks).

ALTER TABLE "UserLimit"
  ADD COLUMN IF NOT EXISTS "instantDailyCap" DECIMAL(14, 2);
