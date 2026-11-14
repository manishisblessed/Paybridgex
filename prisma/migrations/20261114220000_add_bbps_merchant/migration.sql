-- CreateEnum BbpsMerchantStatus
CREATE TYPE "BbpsMerchantStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED');

-- CreateTable BbpsMerchant
CREATE TABLE "BbpsMerchant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerMerchantId" TEXT,
    "kycStatus" TEXT,
    "status" "BbpsMerchantStatus" NOT NULL DEFAULT 'PENDING',
    "meta" JSONB,
    "activatedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BbpsMerchant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BbpsMerchant_userId_key" ON "BbpsMerchant"("userId");

-- CreateIndex
CREATE INDEX "BbpsMerchant_status_idx" ON "BbpsMerchant"("status");

-- CreateIndex
CREATE INDEX "BbpsMerchant_providerMerchantId_idx" ON "BbpsMerchant"("providerMerchantId");

-- AddForeignKey
ALTER TABLE "BbpsMerchant" ADD CONSTRAINT "BbpsMerchant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
