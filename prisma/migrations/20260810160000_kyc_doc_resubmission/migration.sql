-- Document-level KYC rejection & targeted resubmission.
-- Fully ADDITIVE, non-destructive: two new enum values only.
--   - KycStatus.AWAITING_RESUBMISSION  → KYC parked while the applicant
--     re-uploads the specific documents an admin flagged.
--   - InviteStatus.RESUBMIT            → onboarding link re-opened for a
--     targeted document re-upload (keeps the applicant's userId attached).
-- Rejected documents themselves are tracked on VerificationResult via
-- status = 'Rejected' + responsePayload (no schema change needed there).

-- AlterEnum
ALTER TYPE "KycStatus" ADD VALUE 'AWAITING_RESUBMISSION';

-- AlterEnum
ALTER TYPE "InviteStatus" ADD VALUE 'RESUBMIT';
