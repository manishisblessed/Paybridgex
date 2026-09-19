-- Manual POS slip submissions (Yes Bank & other no-API "External POS" acquirers).
-- Retailers upload a physical slip for a terminal assigned to them; an admin
-- approves/rejects. On approval the downstream money path (mirror -> payin ->
-- settlement -> commission/TDS) is shared with the automatic (API) POS flow.

CREATE TABLE "PosManualSlip" (
    "id" TEXT NOT NULL,
    "uploaderUserId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "tid" TEXT NOT NULL,
    "grossAmount" DECIMAL(14,2) NOT NULL,
    "paymentMode" TEXT NOT NULL DEFAULT 'CARD',
    -- Retailer-chosen settlement timing: "T1" = next-day sweep, "INSTANT" =
    -- credit at admin approval (still gated by the platform instant kill-switch
    -- + daily instant budget, falling back to T1).
    "settlementPref" TEXT NOT NULL DEFAULT 'T1',
    "rrn" TEXT,
    "authCode" TEXT,
    "cardType" TEXT,
    "brandType" TEXT,
    "txnTime" TIMESTAMP(3),
    "slipPublicId" TEXT NOT NULL,
    "slipFormat" TEXT,
    "slipResourceType" TEXT NOT NULL DEFAULT 'image',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "transactionRef" TEXT,
    "settlementEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosManualSlip_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PosManualSlip_transactionRef_key" ON "PosManualSlip"("transactionRef");
CREATE INDEX "PosManualSlip_uploaderUserId_status_idx" ON "PosManualSlip"("uploaderUserId", "status");
CREATE INDEX "PosManualSlip_status_createdAt_idx" ON "PosManualSlip"("status", "createdAt");
CREATE INDEX "PosManualSlip_settlementPref_status_idx" ON "PosManualSlip"("settlementPref", "status");
CREATE INDEX "PosManualSlip_machineId_idx" ON "PosManualSlip"("machineId");
CREATE INDEX "PosManualSlip_tid_idx" ON "PosManualSlip"("tid");

-- Harden the duplicate guard at the DB level: at most one PENDING/APPROVED slip
-- per (tid, rrn). REJECTED slips are excluded so a retailer can re-upload after a
-- rejection, and NULL RRNs are excluded (no acquirer reference to dedupe on).
-- Prisma can't express partial indexes, so this lives in SQL only.
CREATE UNIQUE INDEX "PosManualSlip_tid_rrn_active_key"
  ON "PosManualSlip" ("tid", "rrn")
  WHERE "rrn" IS NOT NULL AND "status" IN ('PENDING', 'APPROVED');

ALTER TABLE "PosManualSlip"
    ADD CONSTRAINT "PosManualSlip_uploaderUserId_fkey" FOREIGN KEY ("uploaderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PosManualSlip"
    ADD CONSTRAINT "PosManualSlip_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
