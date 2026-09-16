-- POS machine booking / self-service rental request lifecycle.
-- Additive-only: new enum + two new tables + FKs/indexes. Safe to apply online.

-- CreateEnum
CREATE TYPE "PosBookingStatus" AS ENUM ('APPLIED', 'ASSIGNED', 'DISPATCHED', 'DELIVERED', 'CANCELLED');

-- CreateTable
CREATE TABLE "PosBookingRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "PosBookingStatus" NOT NULL DEFAULT 'APPLIED',
    "deliveryAddress" TEXT NOT NULL,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "monthlyRent" DECIMAL(14,2) NOT NULL,
    "includeGst" BOOLEAN NOT NULL DEFAULT false,
    "gstAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "setupFee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "deposit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "billingDay" INTEGER NOT NULL DEFAULT 1,
    "chargeTxnId" TEXT,
    "refundTxnId" TEXT,
    "machineId" TEXT,
    "subscriptionId" TEXT,
    "assignedById" TEXT,
    "assignedAt" TIMESTAMP(3),
    "dispatchedAt" TIMESTAMP(3),
    "courier" TEXT,
    "trackingRef" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosBookingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosBookingEvent" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "status" "PosBookingStatus" NOT NULL,
    "note" TEXT,
    "byUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosBookingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PosBookingRequest_chargeTxnId_key" ON "PosBookingRequest"("chargeTxnId");

-- CreateIndex
CREATE UNIQUE INDEX "PosBookingRequest_refundTxnId_key" ON "PosBookingRequest"("refundTxnId");

-- CreateIndex
CREATE INDEX "PosBookingRequest_userId_status_idx" ON "PosBookingRequest"("userId", "status");

-- CreateIndex
CREATE INDEX "PosBookingRequest_status_createdAt_idx" ON "PosBookingRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PosBookingRequest_machineId_idx" ON "PosBookingRequest"("machineId");

-- CreateIndex
CREATE INDEX "PosBookingEvent_bookingId_createdAt_idx" ON "PosBookingEvent"("bookingId", "createdAt");

-- AddForeignKey
ALTER TABLE "PosBookingRequest" ADD CONSTRAINT "PosBookingRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosBookingRequest" ADD CONSTRAINT "PosBookingRequest_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PosRentalPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosBookingRequest" ADD CONSTRAINT "PosBookingRequest_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "PosMachine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosBookingEvent" ADD CONSTRAINT "PosBookingEvent_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "PosBookingRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
