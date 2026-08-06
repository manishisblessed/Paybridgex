/**
 * Unwind commissions that were distributed BEFORE settlement (the pre-fix
 * behaviour): the stale worker booked the MDR margin + upline (DT/MD/SD)
 * commissions at CAPTURE time, even for T+1 entries that are still awaiting
 * settlement. This script reverses those early books for every POS / PG
 * settlement entry that is still PENDING (or FAILED), so the money is
 * re-distributed cleanly WHEN the entry actually settles (tomorrow's T+1
 * morning sweep, or an instant settle).
 *
 * Per unsettled entry, for each upline recipient that was paid early:
 *   1. DEBIT the recipient's PRIMARY wallet by the NET they received
 *      (key `unwind-comm:<txnId>:<uid>`, reason ADJUSTMENT)
 *   2. CREDIT the Revenue Wallet back the GROSS that funded the payout
 *      (key `unwind-comm-refund:<txnId>:<uid>`, reason ADJUSTMENT)
 *   3. DEBIT the TDS Payable account by the withheld TDS
 *      (key `unwind-tds:<txnId>:<uid>`, reason TDS_WITHHELD)
 *   4. Delete the TdsLedgerEntry + CommissionCredit records
 *   5. Rename the ORIGINAL idempotency keys (suffix `:unwound`) so the
 *      settlement-time distribution can re-run for real.
 * Then, once every recipient of the transaction is unwound:
 *   6. DEBIT the Revenue Wallet by the early MDR margin
 *      (key `unwind-margin:<txnId>`, reason ADJUSTMENT) + rename its key,
 *      and reset Transaction.commission to 0 (POS rows also get their
 *      placeholder service upgraded WALLET_TOPUP → POS).
 *
 * Net effect per unsettled transaction: recipient wallets −net, TDS account
 * −tds, Revenue Wallet −(margin − Σgross) — i.e. every early book is erased.
 * Settlement then re-prices and re-books everything at the correct moment.
 *
 * SAFETY:
 *   - Dry-run by default: prints what would change, writes NOTHING.
 *     Pass `--apply` to execute.
 *   - Every movement is idempotency-keyed → re-running is always safe.
 *   - A recipient whose wallet can't cover the claw-back is SKIPPED and
 *     reported (their original keys stay intact, so settlement will NOT
 *     double-pay them — their early commission simply stands as paid).
 *
 * Run (repo root, DATABASE_URL set):
 *   npx tsx scripts/unwind-early-commissions.ts            # dry-run
 *   npx tsx scripts/unwind-early-commissions.ts --apply    # write
 */
import "./_load-env";
import { prisma } from "../src/lib/db";
import { creditWallet, debitWallet, LedgerError } from "../src/lib/ledger";
import { getRevenueAccountId } from "../src/lib/commission/revenue";
import { getTdsAccountId } from "../src/lib/commission/tdsAccount";
import { dec, gt, sub, toNumber } from "../src/lib/money";

const APPLY = process.argv.includes("--apply");

type Rail = "POS" | "PG";

function log(msg: string) {
  // eslint-disable-next-line no-console
  console.log(msg);
}

/** Rename a wallet txn's idempotency key so the movement can be re-applied later. */
async function retireKey(walletTxnId: string, key: string) {
  await prisma.walletTxn.updateMany({
    where: { id: walletTxnId, idempotencyKey: key },
    data: { idempotencyKey: `${key}:unwound` },
  });
}

async function main() {
  log(`[unwind-early-commissions] mode: ${APPLY ? "APPLY (writing)" : "DRY-RUN (no writes)"}`);

  const revenueId = await getRevenueAccountId();
  if (!revenueId) throw new Error("No revenue account (MASTER_ADMIN) found — aborting");
  const tdsAccountId = await getTdsAccountId();

  // Every POS/PG entry still awaiting settlement (or failed) — if commission
  // was already distributed for it, that distribution was premature.
  const posEntries = await prisma.posSettlementEntry.findMany({
    where: { status: { in: ["PENDING", "FAILED"] } },
    select: { id: true, transactionRef: true, status: true, mode: true },
  });
  const pgEntries = await prisma.pgSettlementEntry.findMany({
    where: { status: { in: ["PENDING", "FAILED"] } },
    select: { id: true, transactionRef: true, status: true, mode: true },
  });

  const targets: Array<{ rail: Rail; ref: string; status: string; refId: string }> = [
    ...posEntries.map((e) => ({
      rail: "POS" as Rail,
      ref: e.transactionRef,
      status: e.status,
      refId: `POS:${e.transactionRef}`,
    })),
    ...pgEntries.map((e) => ({
      rail: "PG" as Rail,
      ref: e.transactionRef,
      status: e.status,
      refId: `PG${e.transactionRef.slice(-10).toUpperCase()}`,
    })),
  ];

  log(
    `[unwind-early-commissions] scanning ${posEntries.length} POS + ${pgEntries.length} PG unsettled entr(ies)…\n`
  );

  let txnsTouched = 0;
  let recipientsUnwound = 0;
  let recipientsSkipped = 0;
  let totalNetClawedBack = 0;
  let totalGrossRefunded = 0;
  let totalTdsReversed = 0;
  let totalMarginReversed = 0;
  const shortfalls: Array<{ userId: string; amount: number; txnRefId: string }> = [];

  for (const t of targets) {
    const txn = await prisma.transaction.findUnique({ where: { refId: t.refId } });
    if (!txn) continue; // no synthetic txn → nothing was distributed early

    const marginKey = `revenue-margin:${txn.id}`;
    const marginTxn = await prisma.walletTxn.findUnique({ where: { idempotencyKey: marginKey } });
    const fundingDebits = await prisma.walletTxn.findMany({
      where: { idempotencyKey: { startsWith: `revenue-comm-debit:${txn.id}:` } },
    });
    if (!marginTxn && fundingDebits.length === 0) continue; // already clean

    txnsTouched++;
    log(`— ${t.rail} ${t.ref} (${t.status}) · txn ${txn.refId}`);

    let allRecipientsClean = true;

    for (const funding of fundingDebits) {
      const fundingKey = funding.idempotencyKey!;
      const recipientId = fundingKey.split(":")[2];
      const gross = dec(funding.amount);

      const commKey = `commission:${txn.id}:${recipientId}`;
      const tdsWithheldKey = `tds-withheld:${txn.id}:${recipientId}`;
      const commTxn = await prisma.walletTxn.findUnique({ where: { idempotencyKey: commKey } });
      const tdsTxn = await prisma.walletTxn.findUnique({
        where: { idempotencyKey: tdsWithheldKey },
      });

      const net = commTxn ? dec(commTxn.amount) : dec(0);
      const tds = tdsTxn ? dec(tdsTxn.amount) : sub(gross, net);

      log(
        `    recipient ${recipientId}: claw back net ₹${toNumber(net)}, refund gross ₹${toNumber(
          gross
        )} to revenue, reverse TDS ₹${toNumber(tds)}`
      );

      if (!APPLY) {
        recipientsUnwound++;
        totalNetClawedBack += toNumber(net);
        totalGrossRefunded += toNumber(gross);
        totalTdsReversed += toNumber(tds);
        continue;
      }

      // 1. Claw the NET back from the recipient. If they can't cover it, skip
      //    the whole recipient — their original keys stay, so settlement will
      //    not double-pay; the early commission simply stands.
      if (commTxn && gt(net, 0)) {
        try {
          await debitWallet({
            userId: recipientId,
            amount: net,
            reason: "ADJUSTMENT",
            refType: "Transaction",
            refId: txn.id,
            note: `Reversal of early ${t.rail} commission (paid before settlement) — will re-credit at settlement`,
            idempotencyKey: `unwind-comm:${txn.id}:${recipientId}`,
          });
        } catch (e) {
          if (e instanceof LedgerError && e.code === "INSUFFICIENT_FUNDS") {
            recipientsSkipped++;
            allRecipientsClean = false;
            shortfalls.push({ userId: recipientId, amount: toNumber(net), txnRefId: txn.refId });
            log(`      SKIPPED — insufficient balance to claw back ₹${toNumber(net)}`);
            continue;
          }
          throw e;
        }
      }

      // 2. Refund the GROSS funding back to the Revenue Wallet.
      await creditWallet({
        userId: revenueId,
        amount: gross,
        reason: "ADJUSTMENT",
        walletType: "REVENUE",
        refType: "Transaction",
        refId: txn.id,
        note: `Refund of early commission funding on ${txn.service} ← ${recipientId}`,
        idempotencyKey: `unwind-comm-refund:${txn.id}:${recipientId}`,
      });

      // 3. Pull the withheld TDS back out of the TDS Payable account.
      if (tdsTxn && gt(tds, 0)) {
        await debitWallet({
          userId: tdsAccountId,
          amount: tds,
          reason: "TDS_WITHHELD",
          refType: "Transaction",
          refId: txn.id,
          note: `Reversal of TDS withheld on early ${t.rail} commission → ${recipientId}`,
          idempotencyKey: `unwind-tds:${txn.id}:${recipientId}`,
        });
      }

      // 4. Remove the liability + credit records so settlement re-creates them.
      await prisma.tdsLedgerEntry.deleteMany({
        where: { idempotencyKey: `tds:${txn.id}:${recipientId}` },
      });
      await prisma.commissionCredit.deleteMany({
        where: { transactionId: txn.id, userId: recipientId },
      });

      // 5. Retire the original idempotency keys so distribution re-runs fresh.
      if (commTxn) await retireKey(commTxn.id, commKey);
      await retireKey(funding.id, fundingKey);
      if (tdsTxn) await retireKey(tdsTxn.id, tdsWithheldKey);

      recipientsUnwound++;
      totalNetClawedBack += toNumber(net);
      totalGrossRefunded += toNumber(gross);
      totalTdsReversed += toNumber(tds);
    }

    // 6. Margin: only reverse once every recipient is unwound (a recipient we
    //    couldn't claw back keeps their funding inside the margin).
    if (marginTxn && allRecipientsClean) {
      const margin = dec(marginTxn.amount);
      log(`    revenue: reverse early MDR margin ₹${toNumber(margin)}`);
      if (APPLY) {
        await debitWallet({
          userId: revenueId,
          amount: margin,
          reason: "ADJUSTMENT",
          walletType: "REVENUE",
          refType: "Transaction",
          refId: txn.id,
          note: `Reversal of early MDR margin on ${txn.service} (booked before settlement)`,
          idempotencyKey: `unwind-margin:${txn.id}`,
        });
        await retireKey(marginTxn.id, marginKey);
        await prisma.transaction.update({
          where: { id: txn.id },
          data: {
            commission: dec(0),
            // Old worker wrote POS synthetic txns with the WALLET_TOPUP
            // placeholder; upgrade so per-service reports attribute correctly.
            ...(t.rail === "POS" && txn.service !== "POS" ? { service: "POS" } : {}),
          },
        });
      }
      totalMarginReversed += toNumber(margin);
    } else if (marginTxn && !allRecipientsClean) {
      log(`    revenue: margin ₹${toNumber(dec(marginTxn.amount))} KEPT (a recipient could not be clawed back)`);
    }
  }

  log("\n──────────────── summary ────────────────");
  log(`  transactions with early books : ${txnsTouched}`);
  log(`  recipients unwound            : ${recipientsUnwound}`);
  log(`  recipients skipped (shortfall): ${recipientsSkipped}`);
  log(`  net clawed back from uplines  : ₹${totalNetClawedBack.toFixed(2)}`);
  log(`  gross refunded to revenue     : ₹${totalGrossRefunded.toFixed(2)}`);
  log(`  TDS reversed                  : ₹${totalTdsReversed.toFixed(2)}`);
  log(`  MDR margin reversed           : ₹${totalMarginReversed.toFixed(2)}`);
  log(
    `  revenue wallet net change     : ₹${(totalGrossRefunded - totalMarginReversed).toFixed(2)}`
  );
  if (shortfalls.length > 0) {
    log("\n  ⚠ recipients with insufficient balance (early commission left standing):");
    for (const s of shortfalls) log(`    - ${s.userId}: ₹${s.amount.toFixed(2)} on ${s.txnRefId}`);
  }
  if (!APPLY) log("\n[unwind-early-commissions] DRY-RUN complete — re-run with --apply to write.");
  else log("\n[unwind-early-commissions] APPLY complete.");
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[unwind-early-commissions] FAILED:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
