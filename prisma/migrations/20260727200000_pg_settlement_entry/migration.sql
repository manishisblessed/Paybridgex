-- PG (payment gateway) acquirer settlement entry — the scheme-priced analogue of
-- PosSettlementEntry. A confirmed hosted-checkout / UPI-collect payment lands
-- here; MDR is priced against the retailer's assigned Scheme (PG slab), the
-- acquirer cost is re-verified against the provider's live rail rate card
-- (RailMdrRate), and the NET is credited to the retailer wallet (instant on
-- confirmation, or swept by the PG T+1 cron).

CREATE TABLE "PgSettlementEntry" (
    "id" TEXT NOT NULL,
    "transactionRef" TEXT NOT NULL,
    "orderId" TEXT,
    "userId" TEXT NOT NULL,
    "grossAmount" DECIMAL(14,2) NOT NULL,
    "mdrAmount" DECIMAL(14,2) NOT NULL,
    "netAmount" DECIMAL(14,2) NOT NULL,
    "vendorAmount" DECIMAL(14,2),
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "settledAt" TIMESTAMP(3),
    "settledVia" TEXT,
    "walletTxnId" TEXT,
    "paymentMode" TEXT,
    "provider" TEXT,
    "schemeId" TEXT,
    "slabId" TEXT,
    "vendorRateId" TEXT,
    "capturedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PgSettlementEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PgSettlementEntry_transactionRef_key" ON "PgSettlementEntry"("transactionRef");
CREATE INDEX "PgSettlementEntry_userId_createdAt_idx" ON "PgSettlementEntry"("userId", "createdAt");
CREATE INDEX "PgSettlementEntry_status_createdAt_idx" ON "PgSettlementEntry"("status", "createdAt");
CREATE INDEX "PgSettlementEntry_status_capturedAt_idx" ON "PgSettlementEntry"("status", "capturedAt");

ALTER TABLE "PgSettlementEntry" ADD CONSTRAINT "PgSettlementEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
