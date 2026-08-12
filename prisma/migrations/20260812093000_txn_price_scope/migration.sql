-- Per-product pricing scope for BBPS/CC transactions.
--
-- Records the product a charge-driven service transaction was priced under (the
-- ServiceRoute key, e.g. "bbps_credit_card" vs "rechargekit_cc") so two products
-- riding the same partner can be priced, floored, and revenue-reported
-- independently. Nullable + no default backfill: existing rows stay null and are
-- reported under the partner-family fallback. Additive and safe to apply while
-- the app is running (no row locks, no backfill).
ALTER TABLE "Transaction"
  ADD COLUMN IF NOT EXISTS "priceScope" TEXT;
