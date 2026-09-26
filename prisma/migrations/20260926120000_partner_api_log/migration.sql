-- Durable, append-only log of every money-moving partner API call. The shared
-- transport (samedayRequest) inserts the `request` BEFORE the HTTP call and
-- patches the `response` + mined `providerRef` the instant it returns. This
-- survives a process death that happens after the provider processed a payment
-- but before runTransaction stored the response on the Transaction, so recon
-- can recover the provider poll key (request_id/order_id/txn_id) and finalize
-- idempotently instead of stranding the money. Correlated to the Transaction by
-- refId via an async call context.

CREATE TABLE "PartnerApiLog" (
    "id" TEXT NOT NULL,
    "txnRefId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'SAMEDAY',
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "providerRef" TEXT,
    "request" JSONB,
    "response" JSONB,
    "httpStatus" INTEGER,
    "ok" BOOLEAN,
    "code" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerApiLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PartnerApiLog_txnRefId_idx" ON "PartnerApiLog"("txnRefId");
CREATE INDEX "PartnerApiLog_providerRef_idx" ON "PartnerApiLog"("providerRef");
CREATE INDEX "PartnerApiLog_createdAt_idx" ON "PartnerApiLog"("createdAt");
