-- QR claims now support RuPay credit-card collections.
-- Fully ADDITIVE / non-destructive:
--   - "utr"       becomes OPTIONAL (card payments have no UPI UTR). The unique
--                 index stays; Postgres allows multiple NULLs, so card-only
--                 claims never collide on it.
--   - "paidAt"    becomes OPTIONAL (retailers may leave the paid-on time blank).
--   - "cardLast4" added (nullable) — app-required for new claims; NULL on the
--                 pre-existing UPI-only rows so no historical data is touched.

-- AlterTable
ALTER TABLE "QrClaim" ALTER COLUMN "utr" DROP NOT NULL;
ALTER TABLE "QrClaim" ALTER COLUMN "paidAt" DROP NOT NULL;
ALTER TABLE "QrClaim" ADD COLUMN "cardLast4" TEXT;
