-- Risk limit TIERS: a reusable per-service ceiling matrix, auto-assigned from
-- KYC/role and editable at runtime. Additive + backward compatible: existing
-- users keep NULL limitProfileId (tier derived by policy) and the risk engine
-- falls back to its current defaults until a tier resolves.

-- 1. Tier table -------------------------------------------------------------
CREATE TABLE "LimitProfile" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "dailyAmountCap" DECIMAL(14,2),
    "dailyCountCap" INTEGER,
    "nightFactor" DOUBLE PRECISION,
    "serviceCaps" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LimitProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LimitProfile_key_key" ON "LimitProfile"("key");
CREATE INDEX "LimitProfile_active_idx" ON "LimitProfile"("active");
CREATE INDEX "LimitProfile_isDefault_idx" ON "LimitProfile"("isDefault");

-- 2. User pin ---------------------------------------------------------------
ALTER TABLE "User" ADD COLUMN "limitProfileId" TEXT;

ALTER TABLE "User"
    ADD CONSTRAINT "User_limitProfileId_fkey"
    FOREIGN KEY ("limitProfileId") REFERENCES "LimitProfile"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Seed the three baseline tiers ------------------------------------------
-- STARTER  : pre-KYC / new. Credit-card bill pay disabled (0), low overall cap.
-- STANDARD : full-KYC default — matches today's ₹5,00,000 behaviour.
-- PREMIUM  : trusted high-volume accounts.
INSERT INTO "LimitProfile"
    ("id", "key", "name", "description", "active", "isDefault", "dailyAmountCap", "serviceCaps", "updatedAt")
VALUES
    ('lp_starter',  'STARTER',  'Starter',  'New / KYC-pending accounts. Card bill pay off; low daily ceiling.', true, true,  50000,   '{"BILL_CREDIT_CARD": 0, "PAYOUT": 25000}',       CURRENT_TIMESTAMP),
    ('lp_standard', 'STANDARD', 'Standard', 'Full-KYC default tier (matches the legacy ₹5,00,000 cap).',          true, false, 500000,  '{"BILL_CREDIT_CARD": 100000, "PAYOUT": 200000}', CURRENT_TIMESTAMP),
    ('lp_premium',  'PREMIUM',  'Premium',  'Trusted, high-volume accounts.',                                     true, false, 2000000, '{"BILL_CREDIT_CARD": 500000, "PAYOUT": 1000000}',CURRENT_TIMESTAMP);
