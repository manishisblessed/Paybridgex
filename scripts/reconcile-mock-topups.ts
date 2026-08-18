/**
 * Reconcile phantom wallet balance minted by the MOCK UPI provider.
 *
 * While `PARTNER_UPI_ENABLED` was false (or no live PG was configured), the
 * wallet top-up rail resolved to `mock.mockUpi`, whose `status()` ALWAYS reports
 * PAID. Every such "top-up" credited the user's wallet with money that was never
 * actually collected — phantom balance that could then be pushed down the
 * network (DT → retailer), spent, or withdrawn.
 *
 * This script finds those phantom credits and reverses them:
 *
 *   phantom top-up = Transaction where
 *       service = 'WALLET_TOPUP' AND status = 'SUCCESS' AND partner = 'MOCK-UPI'
 *   (each credited its user by `amount` via WalletTxn key `topup:<txnId>`).
 *
 * Per user, it best-effort claws back the minted total from their CURRENT
 * spendable balance (a single ADJUSTMENT debit, idempotency-keyed so re-runs are
 * safe). Money that already left the user's wallet (pushed/spent) cannot be
 * clawed without driving them negative (the DB CHECK constraint would refuse it
 * anyway) — that residual is REPORTED per user as an outstanding debt to place a
 * lien on / recover manually.
 *
 * SAFETY:
 *   - Dry-run by default: prints the full plan, writes NOTHING.
 *     Pass `--apply` to execute the clawbacks.
 *   - Every debit is idempotency-keyed (`reconcile-mock-topup:<uid>`) → safe to
 *     re-run.
 *   - A user whose spendable can't cover the full minted amount is clawed for
 *     whatever they have and the shortfall is reported (never forced negative).
 *
 * Run (repo root, DATABASE_URL set, IP allow-listed on Supabase):
 *   npx tsx scripts/reconcile-mock-topups.ts            # dry-run (report only)
 *   npx tsx scripts/reconcile-mock-topups.ts --apply    # execute clawbacks
 */
import "./_load-env";
import { prisma } from "../src/lib/db";
import { debitWallet, getBalances, LedgerError } from "../src/lib/ledger";
import { add, dec, gt, sub, toNumber, type Money } from "../src/lib/money";

const APPLY = process.argv.includes("--apply");
/** partner name written by initiateTopup when the UPI rail is the mock adapter. */
const MOCK_PARTNER = "MOCK-UPI";

function log(msg: string) {
  // eslint-disable-next-line no-console
  console.log(msg);
}
function money(m: Money | string | number): string {
  return `₹${toNumber(m).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function main() {
  log(`[reconcile-mock-topups] mode: ${APPLY ? "APPLY (writing)" : "DRY-RUN (no writes)"}`);

  // Every mock-settled top-up that actually credited a wallet.
  const phantom = await prisma.transaction.findMany({
    where: { service: "WALLET_TOPUP", status: "SUCCESS", partner: MOCK_PARTNER },
    select: { id: true, refId: true, userId: true, amount: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  if (phantom.length === 0) {
    log("No mock-minted top-ups found (partner='MOCK-UPI', service='WALLET_TOPUP', status='SUCCESS'). Nothing to do.");
    return;
  }

  // Group minted totals by user.
  const byUser = new Map<string, { minted: Money; count: number }>();
  for (const t of phantom) {
    const cur = byUser.get(t.userId) ?? { minted: dec(0), count: 0 };
    cur.minted = add(cur.minted, t.amount);
    cur.count += 1;
    byUser.set(t.userId, cur);
  }

  const users = await prisma.user.findMany({
    where: { id: { in: [...byUser.keys()] } },
    select: { id: true, name: true, userCode: true, role: true },
  });
  const userMeta = new Map(users.map((u) => [u.id, u]));

  // Amounts already reversed by a previous run (idempotency key per user).
  const priorClawbacks = await prisma.walletTxn.findMany({
    where: { idempotencyKey: { in: [...byUser.keys()].map((id) => `reconcile-mock-topup:${id}`) } },
    select: { userId: true, amount: true },
  });
  const alreadyClawed = new Map(priorClawbacks.map((t) => [t.userId, t.amount as Money]));

  let totalMinted = dec(0);
  let totalClawable = dec(0);
  let totalResidual = dec(0);

  log(`\nFound ${phantom.length} phantom top-up(s) across ${byUser.size} user(s):\n`);
  log(
    [
      "USER".padEnd(28),
      "ROLE".padEnd(20),
      "TOP-UPS".padStart(8),
      "MINTED".padStart(14),
      "DONE".padStart(12),
      "SPENDABLE".padStart(14),
      "CLAWBACK".padStart(14),
      "RESIDUAL".padStart(14),
    ].join(" ")
  );

  const plan: Array<{ userId: string; claw: Money; residual: Money }> = [];

  for (const [userId, { minted, count }] of byUser) {
    const meta = userMeta.get(userId);
    const bal = await getBalances(userId).catch(() => null);
    const spendable = bal?.spendable ?? dec(0);
    // Outstanding phantom still to reverse = minted minus what a prior run reversed.
    const done = alreadyClawed.get(userId) ?? dec(0);
    const outstanding = gt(sub(minted, done), 0) ? sub(minted, done) : dec(0);
    const claw = gt(outstanding, spendable) ? spendable : outstanding; // min(outstanding, spendable)
    const residual = sub(outstanding, claw);

    totalMinted = add(totalMinted, minted);
    totalClawable = add(totalClawable, claw);
    totalResidual = add(totalResidual, residual);
    plan.push({ userId, claw, residual });

    log(
      [
        `${meta?.name ?? userId}`.slice(0, 27).padEnd(28),
        `${meta?.userCode ?? ""} ${meta?.role ?? ""}`.trim().slice(0, 19).padEnd(20),
        String(count).padStart(8),
        money(minted).padStart(14),
        money(done).padStart(12),
        money(spendable).padStart(14),
        money(claw).padStart(14),
        money(residual).padStart(14),
      ].join(" ")
    );
  }

  log(
    `\nTOTAL minted: ${money(totalMinted)} | immediately clawable: ${money(totalClawable)} | residual (already moved/spent): ${money(totalResidual)}`
  );

  if (!APPLY) {
    log("\nDRY-RUN complete — no money moved. Re-run with --apply to execute the clawbacks above.");
    if (gt(totalResidual, 0)) {
      log(
        "NOTE: the residual is phantom money that already left these wallets (pushed to a\n" +
          "      retailer or spent). It cannot be clawed without forcing a negative balance.\n" +
          "      Decide per user whether to place a recovery lien or write it off."
      );
    }
    return;
  }

  log("\n--apply set — executing clawbacks…\n");
  let clawedOk = dec(0);
  for (const { userId, claw } of plan) {
    if (!gt(claw, 0)) continue;
    const meta = userMeta.get(userId);
    try {
      await debitWallet({
        userId,
        amount: claw,
        reason: "ADJUSTMENT",
        refType: "MockTopupReconcile",
        note: "Reversal of phantom wallet top-up (mock PG — no real payment was collected)",
        idempotencyKey: `reconcile-mock-topup:${userId}`,
      });
      clawedOk = add(clawedOk, claw);
      log(`  ✓ ${meta?.name ?? userId}: clawed back ${money(claw)}`);
    } catch (e) {
      if (e instanceof LedgerError && e.code === "INSUFFICIENT_FUNDS") {
        log(`  ⚠ ${meta?.name ?? userId}: balance changed — insufficient to claw ${money(claw)}; skipped`);
      } else {
        log(`  ✗ ${meta?.name ?? userId}: error — ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  log(`\nDONE. Clawed back ${money(clawedOk)} of ${money(totalMinted)} minted.`);
  if (gt(totalResidual, 0)) {
    log(
      `Residual ${money(totalResidual)} could not be reclaimed (money already left the wallets).\n` +
        "Review the per-user table above and place recovery liens where appropriate."
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
