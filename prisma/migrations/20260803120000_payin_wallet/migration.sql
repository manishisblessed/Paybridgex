-- Company PAYIN monitoring wallet: mirrors the GROSS of every live inbound
-- (POS / PG / QR / top-up) onto the platform-owner account so master-admin can
-- watch real-time business per rail. Credit-only, its own balanceAfter chain.

-- AlterEnum: payin wallet book.
ALTER TYPE "WalletType" ADD VALUE IF NOT EXISTS 'PAYIN';

-- AlterEnum: ledger reason for the payin mirror credit.
ALTER TYPE "WalletReason" ADD VALUE IF NOT EXISTS 'PAYIN_COLLECTION';

-- AlterTable: User — company payin wallet balance (platform-owner account only).
ALTER TABLE "User" ADD COLUMN "payinBalance" DECIMAL(14,2) NOT NULL DEFAULT 0;
