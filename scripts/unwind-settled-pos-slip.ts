/**
 * FULL clean unwind of a SETTLED manual-POS slip (TEST DATA ONLY).
 *
 * The plain clear-pos-slip-txn.ts script refuses SETTLED entries because the
 * retailer (and the whole commission cascade) were already credited. This one
 * completes the job by reversing EVERY ledger movement the settlement created,
 * then deleting all structural rows — leaving zero trace so a fresh test can run.
 *
 * It reverses, for the capture's transactionRef:
 *   • retailer PRIMARY credit         (pos-settle:<ref>)
 *   • company REVENUE margin credit   (revenue-margin:<txnId>)
 *   • per-upline REVENUE funding debit (revenue-comm-debit:<txnId>:<uid>)
 *   • per-upline PRIMARY net credit    (commission:<txnId>:<uid>)
 *   • TDS-account PRIMARY credit       (tds-withheld:<txnId>:<uid>)
 *   • company PAYIN monitor credit     (payin:pos:<ref>)
 * …by reversing each WalletTxn's own effect (CREDIT → subtract, DEBIT → add) on
 * the correct balance book (PRIMARY/REVENUE/PAYIN/AEPS), then DELETING the
 * WalletTxn. Finally deletes CommissionCredit, TdsLedgerEntry, the synthetic
 * Transaction, PosSettlementEntry, PosTransactionMirror and the slip.
 *
 * SAFETY:
 *   • DRY-RUN by default — prints the exact plan. Pass `--apply` to write.
 *   • ABORTS if reversing any CREDIT would push a wallet negative (someone
 *     already spent the test money) — nothing is written.
 *   • Warns about any stray WalletTxn referencing the txn that isn't in the
 *     known key set (won't auto-touch it).
 *   • Everything runs in ONE transaction per slip.
 *
 *   npx tsx scripts/unwind-settled-pos-slip.ts <TID> [--apply]
 */
export {};

try {
  (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.();
} catch {
  /* env provided by the shell */
}

type WType = "PRIMARY" | "REVENUE" | "PAYIN" | "AEPS";
const FIELD: Record<WType, "walletBalance" | "revenueBalance" | "payinBalance" | "aepsBalance"> = {
  PRIMARY: "walletBalance",
  REVENUE: "revenueBalance",
  PAYIN: "payinBalance",
  AEPS: "aepsBalance",
};

async function main() {
  const { prisma } = await import("@/lib/db");
  const { Prisma } = await import("@prisma/client");
  const tid = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!tid || tid.startsWith("--")) {
    console.error("Usage: npx tsx scripts/unwind-settled-pos-slip.ts <TID> [--apply]");
    process.exit(1);
  }

  const toN = (d: unknown) => Number(new Prisma.Decimal(d as never));

  console.log(`\n${apply ? "APPLY" : "DRY-RUN"} — full unwind of settled POS slip(s) for TID ${tid}\n`);

  const slips = await prisma.posManualSlip.findMany({ where: { tid }, orderBy: { createdAt: "desc" } });
  if (!slips.length) return console.log("No manual slips for this TID. Nothing to do.");

  let done = 0;
  for (const slip of slips) {
    const ref = slip.transactionRef;
    console.log("────────────────────────────────────────────────────");
    console.log(`Slip ${slip.id}  status=${slip.status}  ₹${slip.grossAmount}  ref=${ref ?? "(none)"}`);
    if (!ref) {
      console.log("  (never approved — use clear-pos-slip-txn.ts instead)");
      continue;
    }

    const entry = await prisma.posSettlementEntry.findUnique({ where: { transactionRef: ref } });
    const txn = await prisma.transaction.findUnique({ where: { refId: `POS:${ref}` } });

    // Collect every WalletTxn this capture created, by its exact idempotency key.
    const keys: string[] = [`pos-settle:${ref}`, `payin:pos:${ref}`];
    if (txn) {
      keys.push(`revenue-margin:${txn.id}`);
      const funding = await prisma.walletTxn.findMany({
        where: { idempotencyKey: { startsWith: `revenue-comm-debit:${txn.id}:` } },
      });
      for (const f of funding) {
        const uid = f.idempotencyKey!.split(":")[2];
        keys.push(`revenue-comm-debit:${txn.id}:${uid}`, `commission:${txn.id}:${uid}`, `tds-withheld:${txn.id}:${uid}`);
      }
    }
    const txns = await prisma.walletTxn.findMany({ where: { idempotencyKey: { in: keys } } });

    // Stray-safety scan: anything else pointing at this synthetic txn.
    if (txn) {
      const strays = await prisma.walletTxn.findMany({
        where: { refType: "Transaction", refId: txn.id, NOT: { idempotencyKey: { in: keys } } },
      });
      for (const s of strays)
        console.log(`  ⚠ STRAY WalletTxn not in known set: ${s.id} key=${s.idempotencyKey} amt=₹${toN(s.amount)} — NOT touched, review manually.`);
    }

    // Plan the per-user net balance delta and check coverage.
    const userDelta = new Map<string, Map<WType, number>>();
    for (const t of txns) {
      const wt = (t.walletType as WType) ?? "PRIMARY";
      const sign = t.direction === "CREDIT" ? -1 : 1; // reverse the original effect
      const delta = sign * toN(t.amount);
      const m = userDelta.get(t.userId) ?? new Map<WType, number>();
      m.set(wt, (m.get(wt) ?? 0) + delta);
      userDelta.set(t.userId, m);
      console.log(`  reverse ${t.direction} ₹${toN(t.amount)} [${wt}] user ${t.userId}  (key ${t.idempotencyKey})`);
    }

    // Coverage check — never push a book negative.
    let blocked = false;
    for (const [uid, books] of userDelta) {
      const u = await prisma.user.findUnique({
        where: { id: uid },
        select: { name: true, walletBalance: true, revenueBalance: true, payinBalance: true, aepsBalance: true },
      });
      if (!u) continue;
      for (const [wt, delta] of books) {
        const cur = toN((u as never)[FIELD[wt]]);
        const next = cur + delta;
        if (next < -0.005) {
          console.log(`  ✗ ${u.name} ${wt} would go negative: ₹${cur} ${delta >= 0 ? "+" : ""}${delta} = ₹${next.toFixed(2)}`);
          blocked = true;
        }
      }
    }
    if (blocked) {
      console.log("  → ABORTED for this slip (a wallet can't cover the reversal). No changes.");
      continue;
    }

    const ccCount = txn ? await prisma.commissionCredit.count({ where: { transactionId: txn.id } }) : 0;
    const tdsCount = txn ? await prisma.tdsLedgerEntry.count({ where: { idempotencyKey: { startsWith: `tds:${txn.id}:` } } }) : 0;
    const mirror = await prisma.posTransactionMirror.findUnique({ where: { transactionRef: ref } }).catch(() => null);

    console.log(
      `  → will delete: ${txns.length} WalletTxn, ${ccCount} CommissionCredit, ${tdsCount} TdsLedgerEntry` +
        `${txn ? ", 1 Transaction" : ""}${entry ? ", 1 PosSettlementEntry" : ""}${mirror ? ", 1 mirror" : ""}, 1 slip`
    );

    if (!apply) {
      done++;
      continue;
    }

    await prisma.$transaction(async (tx) => {
      // 1. Reverse balances (per user, per book) in one update each.
      for (const [uid, books] of userDelta) {
        const data: Record<string, unknown> = {};
        for (const [wt, delta] of books) {
          data[FIELD[wt]] = { increment: new Prisma.Decimal(delta) };
        }
        await tx.user.update({ where: { id: uid }, data });
      }
      // 2. Delete structural children first (FKs), then parents.
      if (txn) {
        await tx.commissionCredit.deleteMany({ where: { transactionId: txn.id } });
        await tx.tdsLedgerEntry.deleteMany({ where: { idempotencyKey: { startsWith: `tds:${txn.id}:` } } });
      }
      // 3. Null the entry's FK to the retailer credit, then delete the entry,
      //    so deleting that WalletTxn can't trip a restrict.
      if (entry) {
        await tx.posSettlementEntry.update({ where: { id: entry.id }, data: { walletTxnId: null } }).catch(() => {});
        await tx.posSettlementEntry.delete({ where: { id: entry.id } });
      }
      // 4. Delete every WalletTxn we reversed.
      await tx.walletTxn.deleteMany({ where: { id: { in: txns.map((t) => t.id) } } });
      // 5. Delete synthetic Transaction, mirror, slip.
      if (txn) await tx.transaction.delete({ where: { id: txn.id } });
      if (mirror) await tx.posTransactionMirror.delete({ where: { id: mirror.id } });
      await tx.posManualSlip.delete({ where: { id: slip.id } });
    });

    console.log("  ✓ unwound + deleted");
    done++;
  }

  console.log("────────────────────────────────────────────────────");
  console.log(`\n${apply ? "Unwound" : "Would unwind"}: ${done} slip(s).`);
  if (!apply) console.log("Re-run with --apply to perform the unwind.\n");
  await prisma.$disconnect();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
