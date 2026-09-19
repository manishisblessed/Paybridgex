/**
 * Scoped cleanup for a manual External-POS slip transaction (TEST DATA ONLY).
 *
 * Removes every artifact of a manual-slip capture for a given TID so a fresh
 * test can be run from a clean slate:
 *   • PosManualSlip           (the uploaded slip)
 *   • PosSettlementEntry      (the priced settlement row, by transactionRef)
 *   • PosTransactionMirror    (the display read-model, by transactionRef)
 *   • PAYIN WalletTxn         (the company payin monitor credit, keyed
 *                              payin:pos:<ref>) + reverts User.payinBalance
 *
 * SAFETY:
 *   • DRY-RUN by default — prints exactly what it WOULD delete. Pass `--apply`
 *     to actually delete.
 *   • REFUSES to delete a settlement entry that is SETTLED with a wallet credit
 *     (walletTxnId set) — that means the retailer was already paid and needs a
 *     reversal/clawback, not a silent delete.
 *   • Everything runs inside a single transaction per slip.
 *
 * Usage:
 *   npx tsx scripts/clear-pos-slip-txn.ts <TID> [--apply]
 *   e.g.  npx tsx scripts/clear-pos-slip-txn.ts 43159311
 *         npx tsx scripts/clear-pos-slip-txn.ts 43159311 --apply
 */

export {};

try {
  (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.();
} catch {
  /* env provided by the shell */
}

async function main() {
  const { prisma } = await import("@/lib/db");

  const tid = process.argv[2];
  const apply = process.argv.includes("--apply");

  if (!tid || tid.startsWith("--")) {
    console.error("Usage: npx tsx scripts/clear-pos-slip-txn.ts <TID> [--apply]");
    process.exit(1);
  }

  console.log(`\n${apply ? "APPLY" : "DRY-RUN"} — clearing manual POS slip history for TID ${tid}\n`);

  const slips = await prisma.posManualSlip.findMany({
    where: { tid },
    orderBy: { createdAt: "desc" },
  });

  if (slips.length === 0) {
    console.log("No manual slips found for this TID. Nothing to do.");
    return;
  }

  let cleared = 0;
  let skipped = 0;

  for (const slip of slips) {
    const ref = slip.transactionRef;
    console.log("────────────────────────────────────────────────────");
    console.log(`Slip ${slip.id}  status=${slip.status}  amount=₹${slip.grossAmount}  rrn=${slip.rrn ?? "—"}`);
    console.log(`  transactionRef: ${ref ?? "(none — never approved)"}`);

    const entry = ref
      ? await prisma.posSettlementEntry.findUnique({ where: { transactionRef: ref } })
      : null;
    const mirror = ref
      ? await prisma.posTransactionMirror.findUnique({ where: { transactionRef: ref } }).catch(() => null)
      : null;
    const payinTxn = ref
      ? await prisma.walletTxn.findUnique({ where: { idempotencyKey: `payin:pos:${ref}` } }).catch(() => null)
      : null;

    console.log(
      `  settlementEntry: ${entry ? `${entry.id} status=${entry.status} mode=${entry.mode} net=₹${entry.netAmount} walletTxnId=${entry.walletTxnId ?? "none"}` : "(none)"}`
    );
    console.log(`  mirror:          ${mirror ? `${mirror.id} status=${mirror.status}` : "(none)"}`);
    console.log(`  payin credit:    ${payinTxn ? `${payinTxn.id} amount=₹${payinTxn.amount} → user ${payinTxn.userId}` : "(none)"}`);

    // GUARD: a settled entry means the retailer wallet was ALREADY credited.
    // Deleting it would strand the paid money off-ledger — require a proper
    // reversal/clawback instead.
    if (entry && entry.status === "SETTLED" && entry.walletTxnId) {
      console.log("  ⚠ SKIPPED — this entry is SETTLED (retailer already credited). Reverse/clawback it first.");
      skipped++;
      continue;
    }

    if (!apply) {
      console.log("  → would delete: slip" +
        (entry ? " + settlementEntry" : "") +
        (mirror ? " + mirror" : "") +
        (payinTxn ? ` + payin credit (revert ₹${payinTxn.amount} from payinBalance)` : ""));
      cleared++;
      continue;
    }

    await prisma.$transaction(async (tx) => {
      // 1) Revert + delete the company payin monitor credit.
      if (payinTxn) {
        await tx.user.update({
          where: { id: payinTxn.userId },
          data: { payinBalance: { decrement: payinTxn.amount } },
        });
        await tx.walletTxn.delete({ where: { id: payinTxn.id } });
      }
      // 2) Delete the settlement entry (PENDING/REVERSED only — guarded above).
      if (entry) {
        await tx.posSettlementEntry.delete({ where: { id: entry.id } });
      }
      // 3) Delete the display mirror row.
      if (mirror) {
        await tx.posTransactionMirror.delete({ where: { id: mirror.id } });
      }
      // 4) Delete the slip itself.
      await tx.posManualSlip.delete({ where: { id: slip.id } });
    });

    console.log("  ✓ cleared");
    cleared++;
  }

  console.log("────────────────────────────────────────────────────");
  console.log(`\n${apply ? "Cleared" : "Would clear"}: ${cleared} slip(s). Skipped (settled): ${skipped}.`);
  if (!apply) console.log("\nRe-run with --apply to perform the deletion.\n");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
