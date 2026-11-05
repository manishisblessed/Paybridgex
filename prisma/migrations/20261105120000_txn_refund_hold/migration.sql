-- Deferred-refund cooling-off window for SameDay recon-capable rails.
-- A provider "failure" on a card-push rail can arrive while the payment was
-- actually charged (SameDay reverses our float only later), so the reserve must
-- never be released on the first failure signal. The first confirmed failure
-- stamps this timestamp (now + REFUND_HOLD_MINUTES); the reserve is credited
-- back only after it passes AND a fresh provider status re-check still reports a
-- non-success (double-checked) AND no REVERSAL was already posted.
ALTER TABLE "Transaction" ADD COLUMN "refundEligibleAt" TIMESTAMP(3);
