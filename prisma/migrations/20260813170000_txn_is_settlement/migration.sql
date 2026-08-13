-- Flag the SYNTHETIC acquirer-settlement anchor transactions (POS/PG/QR) so the
-- velocity/exposure risk engine and the AML monitor can exclude them. These rows
-- are minted purely to anchor upline commission + per-leg revenue reporting; they
-- represent INBOUND settlement (gross card volume credited to the retailer), NOT a
-- user-initiated OUTBOUND money movement, so counting them as "money moved" wrongly
-- consumed the daily/velocity caps (a retailer whose morning POS T+1 batch settled
-- could not make even a ₹100 outbound payment).
--
-- Adding a NOT NULL column with a constant default is a metadata-only change on
-- PostgreSQL 11+ (no table rewrite, no long lock). Existing real transactions stay
-- false; only the settlement anchors are backfilled to true below.
ALTER TABLE "Transaction"
  ADD COLUMN IF NOT EXISTS "isSettlement" BOOLEAN NOT NULL DEFAULT false;

-- Backfill existing synthetic settlement anchors. The predicate keys off the
-- partner tags that ONLY the settlement creators emit (SAMEDAY_POS / PG / STATIC_QR)
-- and the first-class POS/QR services, plus the settlement refId shapes for any
-- legacy rows once booked under the WALLET_TOPUP placeholder. Real UPI collections
-- ("PGC…", service UPI_COLLECT) and real wallet top-ups ("TOPUP…") are explicitly
-- NOT matched: 'PGC%' is excluded, and neither carries a settlement partner tag.
UPDATE "Transaction"
SET "isSettlement" = true
WHERE
  "partner" IN ('SAMEDAY_POS', 'PG', 'STATIC_QR')
  OR "service"::text IN ('POS', 'QR')
  OR "refId" LIKE 'POS:%'
  OR "refId" LIKE 'QR%'
  OR ("refId" LIKE 'PG%' AND "refId" NOT LIKE 'PGC%');
