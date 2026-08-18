-- Wallet balance integrity backstop.
--
-- The ledger (src/lib/ledger.ts) already guarantees a user can never spend or
-- push more than their spendable balance. These database-level CHECK
-- constraints are the ironclad last line of defence: even a future buggy code
-- path, a bad script, or a manual query can NEVER drive a user's wallet books
-- negative — Postgres aborts the transaction instead.
--
-- Added as NOT VALID so the migration cannot fail on any pre-existing legacy
-- row; the constraints are still fully enforced on every subsequent INSERT and
-- UPDATE (which is exactly what a wallet push/debit performs). Run a follow-up
-- `VALIDATE CONSTRAINT` once balances are confirmed clean if full validation of
-- historical rows is desired.

ALTER TABLE "User"
  ADD CONSTRAINT "user_wallet_balance_nonneg" CHECK ("walletBalance" >= 0) NOT VALID;

ALTER TABLE "User"
  ADD CONSTRAINT "user_held_balance_nonneg" CHECK ("heldBalance" >= 0) NOT VALID;

ALTER TABLE "User"
  ADD CONSTRAINT "user_lien_balance_nonneg" CHECK ("lienBalance" >= 0) NOT VALID;

ALTER TABLE "User"
  ADD CONSTRAINT "user_aeps_balance_nonneg" CHECK ("aepsBalance" >= 0) NOT VALID;
