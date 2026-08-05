-- Settlement leg on the (synthetic) acquirer settlement transaction so revenue
-- reporting can split the company MDR margin into T+1 vs Instant (T+0). "T0" =
-- instant, "T1" = next-day; null for non-settlement services. Additive and safe
-- to apply while the app is running; existing rows stay null.

ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "settlementType" TEXT;
