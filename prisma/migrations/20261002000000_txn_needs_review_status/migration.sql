-- Add NEEDS_REVIEW to the TxnStatus enum.
--
-- Rows land here when a money-moving partner pay call returns an INDETERMINATE
-- result (lost response / HTTP 5xx / timeout): the provider may have charged, so
-- the wallet reserve is HELD (never auto-refunded) and the transaction awaits an
-- authoritative resolution (recon status poll, admin action, or a confirmed
-- idempotent re-call). It is treated as NON-TERMINAL everywhere PROCESSING is.
--
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block on
-- PostgreSQL < 12 and must not be wrapped; Prisma executes enum additions
-- outside the migration transaction automatically. Idempotent guard included so
-- re-running against a DB that already has the value is a no-op.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'TxnStatus' AND e.enumlabel = 'NEEDS_REVIEW'
    ) THEN
        ALTER TYPE "TxnStatus" ADD VALUE 'NEEDS_REVIEW';
    END IF;
END
$$;
