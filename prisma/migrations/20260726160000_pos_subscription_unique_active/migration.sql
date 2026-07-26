-- Guarantee at most ONE active rental subscription per (machine, user).
--
-- Without this, a race (double-click / concurrent batch / client retry) could
-- create two ACTIVE PosSubscription rows for the same machine+user, and the
-- monthly billing engine would then debit the subscriber's wallet twice. This
-- is the DB-level backstop behind the application check.
--
-- NOTE: This is a PARTIAL unique index (WHERE status = 'ACTIVE'), which Prisma
-- schema cannot express, so it lives only in this migration. Multiple CANCELLED
-- rows for the same (machine, user) remain allowed (re-subscribe after cancel).
-- Production applies migrations with `prisma migrate deploy` (file-based, no
-- schema diff), so the index is preserved. If you later run `prisma migrate dev`
-- and it proposes dropping this index, discard that drop.

-- 1) Dedupe any pre-existing duplicate ACTIVE subscriptions before the index is
--    built (otherwise index creation fails). Keep the earliest-created row per
--    (machine, user); cancel the rest.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "machineId", "userId"
      ORDER BY "createdAt" ASC, id ASC
    ) AS rn
  FROM "PosSubscription"
  WHERE status = 'ACTIVE'
)
UPDATE "PosSubscription" s
SET status = 'CANCELLED',
    "cancelledAt" = NOW(),
    "updatedAt" = NOW()
FROM ranked
WHERE s.id = ranked.id
  AND ranked.rn > 1;

-- 2) Enforce uniqueness for ACTIVE subscriptions only.
CREATE UNIQUE INDEX "PosSubscription_active_machine_user_key"
  ON "PosSubscription" ("machineId", "userId")
  WHERE status = 'ACTIVE';
