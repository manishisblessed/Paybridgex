-- Local mirror of the Same Day POS transaction feed — the display READ-MODEL.
-- The dashboard "Live Transactions" feed and report exports read from HERE
-- (indexed SQL) instead of polling the partner API, decoupling the UI from the
-- partner's 100 req/min rate limit. Rows are upserted in real time by the
-- capture webhook and repaired/backfilled by a periodic reconciliation sweep,
-- both keyed on the canonical RRN-based `transactionRef` so they converge on
-- one row per physical swipe (the @unique constraint prevents duplicates).

CREATE TABLE "PosTransactionMirror" (
    "id" TEXT NOT NULL,
    "transactionRef" TEXT NOT NULL,
    "externalId" INTEGER,
    "terminalId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CAPTURED',
    "paymentMode" TEXT NOT NULL DEFAULT 'CARD',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "rrn" TEXT,
    "cardBrand" TEXT,
    "cardType" TEXT,
    "cardNumber" TEXT,
    "cardClassification" TEXT,
    "cardTxnType" TEXT,
    "issuingBank" TEXT,
    "acquiringBank" TEXT,
    "razorpayTxnId" TEXT,
    "externalRef" TEXT,
    "deviceSerial" TEXT,
    "mid" TEXT,
    "authCode" TEXT,
    "txnType" TEXT,
    "customerName" TEXT,
    "payerName" TEXT,
    "receiptUrl" TEXT,
    "txnTime" TIMESTAMP(3) NOT NULL,
    "postingDate" TIMESTAMP(3),
    "partnerCreatedAt" TIMESTAMP(3),
    "raw" JSONB,
    "source" TEXT NOT NULL DEFAULT 'SWEEP',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PosTransactionMirror_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PosTransactionMirror_transactionRef_key" ON "PosTransactionMirror"("transactionRef");
CREATE INDEX "PosTransactionMirror_txnTime_idx" ON "PosTransactionMirror"("txnTime");
CREATE INDEX "PosTransactionMirror_terminalId_txnTime_idx" ON "PosTransactionMirror"("terminalId", "txnTime");
CREATE INDEX "PosTransactionMirror_status_txnTime_idx" ON "PosTransactionMirror"("status", "txnTime");
CREATE INDEX "PosTransactionMirror_paymentMode_idx" ON "PosTransactionMirror"("paymentMode");
