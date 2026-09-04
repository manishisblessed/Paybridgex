-- Same Day POS API v2: reversal (VOID / REFUND) reconciliation support.
-- Adds audit columns so a previously-CAPTURED swipe that is later voided or
-- refunded upstream is retained and reconcilable instead of silently vanishing.

-- Display read-model: record when/why a mirror row flipped to VOIDED/REFUNDED.
ALTER TABLE "PosTransactionMirror" ADD COLUMN "reversedAt" TIMESTAMP(3);
ALTER TABLE "PosTransactionMirror" ADD COLUMN "reversalReason" TEXT;
CREATE INDEX "PosTransactionMirror_reversedAt_idx" ON "PosTransactionMirror"("reversedAt");

-- Settlement ledger: a PENDING entry reversed here is skipped by the crons; a
-- SETTLED entry reversed here is flagged for manual clawback (walletTxnId set).
ALTER TABLE "PosSettlementEntry" ADD COLUMN "reversedAt" TIMESTAMP(3);
ALTER TABLE "PosSettlementEntry" ADD COLUMN "reversalReason" TEXT;
