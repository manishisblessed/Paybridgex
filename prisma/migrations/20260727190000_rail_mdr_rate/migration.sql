-- Per-provider acquiring rate card for the PG & QR rails (analogue of
-- BrandMdrRate for POS). A scheme's PG/QR MDR slab locks its vendor cost to the
-- most specific approved rate here, so no scheme can be priced below cost.

CREATE TABLE "RailMdrRate" (
    "id" TEXT NOT NULL,
    "serviceKind" "MdrServiceKind" NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "scopeLabel" TEXT,
    "provider" TEXT NOT NULL DEFAULT '*',
    "paymentMode" TEXT NOT NULL DEFAULT '*',
    "cardType" TEXT,
    "brandType" TEXT,
    "classification" TEXT,
    "minAmount" DECIMAL(14,2) NOT NULL,
    "maxAmount" DECIMAL(14,2) NOT NULL,
    "mdrType" "RateType" NOT NULL DEFAULT 'PERCENT',
    "mdrValue" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "mdrValueT0" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RailMdrRate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RailMdrRate_serviceKind_scopeKey_active_idx" ON "RailMdrRate"("serviceKind", "scopeKey", "active");
