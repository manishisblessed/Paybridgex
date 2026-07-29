-- Link VerificationResult.inviteId to Invite with a real foreign key so that
-- deleting an invite no longer leaves dangling verification rows behind.
--
-- Behavior: ON DELETE SET NULL (NOT cascade). Deleting an invite detaches its
-- verification records rather than destroying them, preserving the KYC/eKYC
-- verification audit trail for any user linked via VerificationResult.userId.
--
-- Historically there was no FK, so manually deleting invites accumulated
-- orphaned VerificationResult rows (inviteId pointing to a non-existent invite).
-- Those pre-existing orphans must be reconciled BEFORE the FK can be added,
-- otherwise the constraint creation fails.
--
-- This reconciliation is fully NON-DESTRUCTIVE: no rows are deleted. Every
-- orphan (its parent invite was already removed) simply has its dangling
-- inviteId nulled out, so all data — including anything tied to active or
-- pending users — is preserved.

-- 1. Detach every orphan whose referenced invite no longer exists.
UPDATE "VerificationResult" vr
SET "inviteId" = NULL
WHERE vr."inviteId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Invite" i WHERE i."id" = vr."inviteId");

-- 2. Add the foreign key.
ALTER TABLE "VerificationResult"
  ADD CONSTRAINT "VerificationResult_inviteId_fkey"
  FOREIGN KEY ("inviteId") REFERENCES "Invite"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
