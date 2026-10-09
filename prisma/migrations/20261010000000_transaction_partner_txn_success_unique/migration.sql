-- One SUCCESS per provider order.
--
-- A Transaction's `partnerTxnId` is the upstream provider's order id. One real
-- provider order must back AT MOST ONE settled (SUCCESS) Transaction — otherwise
-- a rapid same-card re-tap that collapses to a single upstream order debits the
-- retailer twice (the RT0107 / P2F1791454006YSNK9 incident). This partial unique
-- index is the ironclad, race-proof backstop behind the application-level
-- duplicate guards in src/lib/services/finalize.ts and transaction.ts: a second
-- attempt to settle the same order is rejected (P2002) and auto-refunded instead.
--
-- Scope: only SUCCESS rows with a non-null partnerTxnId are constrained. Rows in
-- PROCESSING / NEEDS_REVIEW / FAILED / REFUNDED may freely share a partnerTxnId
-- (e.g. a failed+refunded leg alongside the one real SUCCESS).
--
-- Like the wallet CHECK constraints (20260817190000_wallet_balance_nonneg), this
-- is a raw, Prisma-unmanaged index: Prisma's schema language cannot express a
-- filtered (partial) unique index, so it lives only here.
--
-- PRE-CONDITION: Postgres cannot build a unique index over existing duplicates.
-- The guard below fails the migration with a precise, actionable message if any
-- provider order still has >1 SUCCESS row — those MUST be reversed first (one
-- leg refunded) so the invariant is true before it is enforced.

DO $$
DECLARE
  dup_count integer;
  dup_list  text;
BEGIN
  SELECT count(*), string_agg(d."partnerTxnId" || ' (' || d.c || ' SUCCESS rows)', ', ')
    INTO dup_count, dup_list
  FROM (
    SELECT "partnerTxnId", count(*) AS c
    FROM "Transaction"
    WHERE "partnerTxnId" IS NOT NULL AND "status" = 'SUCCESS'
    GROUP BY "partnerTxnId"
    HAVING count(*) > 1
  ) d;

  IF dup_count > 0 THEN
    RAISE EXCEPTION
      'Cannot enforce one-SUCCESS-per-order: % provider order(s) still have >1 SUCCESS row and must be reversed first: %',
      dup_count, dup_list;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "transaction_partner_txn_success_uq"
  ON "Transaction" ("partnerTxnId")
  WHERE "partnerTxnId" IS NOT NULL AND "status" = 'SUCCESS';
