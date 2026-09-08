-- CreateTable
CREATE TABLE "PosWebhookDelivery" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosWebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PosWebhookDelivery_deliveryId_key" ON "PosWebhookDelivery"("deliveryId");

-- CreateIndex
CREATE INDEX "PosWebhookDelivery_processedAt_idx" ON "PosWebhookDelivery"("processedAt");
