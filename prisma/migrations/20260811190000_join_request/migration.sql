-- Public "Join Form" lead capture. Replaces self-serve account creation on the
-- marketing site: prospects submit their details, support reviews and converts
-- them into onboarding Invites. Fully additive, non-destructive.

-- CreateEnum
CREATE TYPE "JoinRequestStatus" AS ENUM ('NEW', 'CONTACTED', 'INVITED', 'CLOSED', 'REJECTED');

-- CreateTable
CREATE TABLE "JoinRequest" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "shopName" TEXT,
    "city" TEXT,
    "state" TEXT,
    "role" "Role" NOT NULL DEFAULT 'RETAILER',
    "message" TEXT,
    "status" "JoinRequestStatus" NOT NULL DEFAULT 'NEW',
    "handledById" TEXT,
    "handledAt" TIMESTAMP(3),
    "notes" TEXT,
    "inviteId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JoinRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JoinRequest_status_createdAt_idx" ON "JoinRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "JoinRequest_phone_idx" ON "JoinRequest"("phone");

-- CreateIndex
CREATE INDEX "JoinRequest_email_idx" ON "JoinRequest"("email");
