-- Service-rail (BBPS/Payout) revenue tracking.
--
-- 1. A new WalletReason so the company's service-rail spread (charge − GST −
--    vendor) can be credited to the Revenue Wallet per transaction, mirroring
--    MDR_MARGIN for acquiring rails. Adding an enum value is additive; the new
--    value is only USED by rows inserted later (never within this migration),
--    so it is transaction-safe on modern PostgreSQL.
ALTER TYPE "WalletReason" ADD VALUE IF NOT EXISTS 'SERVICE_MARGIN';

-- 2. Snapshot the locked vendor (upstream) cost on each charge-driven
--    Transaction so company revenue = (fee − gst) − vendorCharge is auditable.
--    Defaults to 0 (no enforcement) so existing rows keep working. Additive +
--    safe to apply while the app is running (no row locks, no backfill).
ALTER TABLE "Transaction"
  ADD COLUMN IF NOT EXISTS "vendorCharge" DECIMAL(14, 2) NOT NULL DEFAULT 0;

-- 3. Snapshot the locked vendor (partner) cost on each PayoutRequest so company
--    revenue = serviceCharge − vendorCharge is auditable. Defaults to 0.
ALTER TABLE "PayoutRequest"
  ADD COLUMN IF NOT EXISTS "vendorCharge" DECIMAL(14, 2) NOT NULL DEFAULT 0;
