-- Phase 13 follow-up — per-user Re-KYC exemption.
-- Fully ADDITIVE, non-destructive: one defaulted boolean column on "User".
-- Existing rows backfill to false (no one is exempt by default). Safe on a live DB.

ALTER TABLE "User" ADD COLUMN "reKycExempt" BOOLEAN NOT NULL DEFAULT false;
