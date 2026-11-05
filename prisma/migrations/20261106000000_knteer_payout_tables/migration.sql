-- ============================================================
-- Migration: 20261106000000_knteer_payout_tables
-- Description: Add KnteerBeneficiary and KnteerPayoutTxn tables
--              for the Same Day Solution Knteer Payout feature.
-- ============================================================

-- ----------------------------------------------------------------
-- Table: knteer_beneficiaries
-- ----------------------------------------------------------------
CREATE TABLE "knteer_beneficiaries" (
    "id"                TEXT         NOT NULL,
    "accountNumber"     TEXT         NOT NULL,            -- AES-256-GCM encrypted
    "accountLast4"      TEXT         NOT NULL,            -- plain last-4 for display
    "ifscCode"          TEXT         NOT NULL,
    "accountHolderName" TEXT         NOT NULL,
    "bankName"          TEXT         NOT NULL,
    "mobile"            TEXT         NOT NULL,
    "referenceId"       TEXT,                             -- nullable, UNIQUE when present
    "registrationType"  TEXT         NOT NULL DEFAULT 'register',
    "verificationCharge" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "isRegistered"      BOOLEAN      NOT NULL DEFAULT true,
    "isBankVerified"    BOOLEAN      NOT NULL DEFAULT false,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,
    CONSTRAINT "knteer_beneficiaries_pkey" PRIMARY KEY ("id")
);

-- Unique constraint on referenceId (nullable — Postgres ignores NULLs here)
CREATE UNIQUE INDEX "knteer_beneficiaries_referenceId_key"
    ON "knteer_beneficiaries"("referenceId");

CREATE INDEX "knteer_beneficiaries_accountLast4_idx"
    ON "knteer_beneficiaries"("accountLast4");

CREATE INDEX "knteer_beneficiaries_ifscCode_idx"
    ON "knteer_beneficiaries"("ifscCode");

-- ----------------------------------------------------------------
-- Table: knteer_payout_txns
-- ----------------------------------------------------------------
CREATE TABLE "knteer_payout_txns" (
    "transactionId"     TEXT          NOT NULL,           -- UUID from Same Day API
    "partnerTransId"    TEXT,                             -- KNT… identifier
    "knteerTransId"     TEXT,                             -- KSPH… internal id
    "beneficiaryId"     TEXT,                             -- FK → knteer_beneficiaries.id
    "accountNumber"     TEXT          NOT NULL,           -- masked as returned by API
    "ifscCode"          TEXT          NOT NULL,
    "accountHolderName" TEXT          NOT NULL,
    "bankName"          TEXT          NOT NULL,
    "mobile"            TEXT          NOT NULL,
    "amount"            DECIMAL(14,2) NOT NULL,
    "charges"           DECIMAL(8,2)  NOT NULL DEFAULT 0,
    "totalDebited"      DECIMAL(14,2) NOT NULL,
    "paymentMode"       TEXT          NOT NULL DEFAULT 'IMPS',
    "remarks"           TEXT,
    "status"            TEXT          NOT NULL DEFAULT 'PENDING',
    "utr"               TEXT,
    "createdAtApi"      TEXT,
    "createdAtIst"      TEXT,
    "completedAtApi"    TEXT,
    "completedAtIst"    TEXT,
    "createdAt"         TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3)  NOT NULL,
    CONSTRAINT "knteer_payout_txns_pkey" PRIMARY KEY ("transactionId")
);

-- Unique constraint on partnerTransId for idempotent upserts
CREATE UNIQUE INDEX "knteer_payout_txns_partnerTransId_key"
    ON "knteer_payout_txns"("partnerTransId");

-- FK → knteer_beneficiaries (nullable — SetNull on delete)
ALTER TABLE "knteer_payout_txns"
    ADD CONSTRAINT "knteer_payout_txns_beneficiaryId_fkey"
    FOREIGN KEY ("beneficiaryId")
    REFERENCES "knteer_beneficiaries"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;

CREATE INDEX "knteer_payout_txns_status_idx"
    ON "knteer_payout_txns"("status");

CREATE INDEX "knteer_payout_txns_createdAt_idx"
    ON "knteer_payout_txns"("createdAt");
