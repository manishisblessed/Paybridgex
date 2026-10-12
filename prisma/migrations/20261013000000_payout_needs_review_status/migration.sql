-- Add NEEDS_REVIEW to the PayoutStatus enum.
--
-- A payout whose SEND outcome was INDETERMINATE (lost HTTP response, 5xx/408/429,
-- or a transport exception) lands here: the bank MAY have disbursed, so the hold
-- is retained (never released back to spendable) until the rail's books are
-- recovered (reference recovery via the settlement list API, an inbound webhook)
-- or an operator resolves it. It is a NON-TERMINAL, funds-HELD state — treated
-- like PROCESSING everywhere (pollable, finalizable to SUCCESS/FAILED/REVERSED).
--
-- NOTE: ALTER TYPE ... ADD VALUE must run outside a transaction block; Prisma
-- executes enum additions outside the migration transaction automatically. The
-- idempotent guard makes re-running against a DB that already has the value a
-- no-op.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'PayoutStatus' AND e.enumlabel = 'NEEDS_REVIEW'
    ) THEN
        ALTER TYPE "PayoutStatus" ADD VALUE 'NEEDS_REVIEW';
    END IF;
END
$$;
