/**
 * One-off recovery for TXNGMPCYOQPAW (Bill Credit Card ₹49,999 + ₹29.50 fee).
 *
 * Provider (Same Day) confirmed this payment as COMPLETED (SDS1793708097667),
 * but our system auto-refunded ₹50,028.50 to the retailer. This script:
 *
 *   1. Places a lien to recover ₹50,028.50 from RT0101 (Balani Raja Hasanand)
 *   2. Resolves the NEEDS_REVIEW txn TXNLWTVLGYL5N (HTTP_429 → refund, never processed)
 *
 * Usage: cd ~/paybridgex && source ../env-paybridgex && npx tsx scripts/recover-txn-sds.ts
 */
import { prisma } from "@/lib/db";
import { placeWalletLien } from "@/lib/wallet/lien";
import { finalizeServiceTransaction, FINALIZABLE_TXN_SELECT } from "@/lib/services/finalize";
import { getBalances } from "@/lib/ledger";

const ORIGINAL_TXN_ID = "cmw0nhl6d007e3ibmtxh9c798"; // TXNGMPCYOQPAW — provider completed
const NEEDS_REVIEW_TXN_ID = "cmw0npna2008k3ibmzroclkbu"; // TXNLWTVLGYL5N — HTTP_429
const USER_ID = "cmtybkldp004mqlvhofja9g95"; // RT0101 Balani Raja Hasanand
const REFUND_AMOUNT = 50028.50; // ₹49,999 + ₹29.50 fee

async function main() {
  // ── Part 1: Recover ₹50,028.50 from wrongly-refunded TXNGMPCYOQPAW ──────

  const txn = await prisma.transaction.findUnique({
    where: { id: ORIGINAL_TXN_ID },
    select: { id: true, refId: true, status: true, amount: true, fee: true, userId: true },
  });
  if (!txn) { console.error("Transaction not found!"); process.exit(1); }
  console.log("=== Part 1: Recovery for", txn.refId, "===");
  console.log("Status:", txn.status, "| Amount:", txn.amount.toString(), "| Fee:", txn.fee.toString());

  if (txn.status !== "FAILED") {
    console.error("Transaction is not FAILED (status:", txn.status, "). Skipping recovery.");
  } else {
    // Check existing lien
    const existingLien = await prisma.walletLien.findFirst({
      where: { refType: "Transaction", refId: ORIGINAL_TXN_ID, status: "ACTIVE" },
    });
    if (existingLien) {
      console.log("Lien already exists:", existingLien.id, "— skipping.");
    } else {
      const balBefore = await getBalances(USER_ID);
      console.log("Wallet BEFORE:", {
        balance: balBefore.walletBalance.toString(),
        lien: balBefore.lienBalance.toString(),
        spendable: balBefore.spendable.toString(),
      });

      console.log("Placing lien for ₹" + REFUND_AMOUNT + "...");
      const lien = await placeWalletLien({
        actorId: USER_ID,
        targetUserId: USER_ID,
        amount: REFUND_AMOUNT,
        reasonCode: "OTHER",
        remarks:
          "Recovery of auto-refunded txn " + txn.refId +
          " — provider confirmed COMPLETED (SDS1793708097667). Bill was paid but system auto-refunded.",
        refType: "Transaction",
        refId: ORIGINAL_TXN_ID,
      });

      console.log("Lien placed!", {
        lienId: lien.id,
        amount: lien.amount.toString(),
        recovered: lien.recoveredAmount.toString(),
        status: lien.status,
      });

      const balAfter = await getBalances(USER_ID);
      console.log("Wallet AFTER:", {
        balance: balAfter.walletBalance.toString(),
        lien: balAfter.lienBalance.toString(),
        spendable: balAfter.spendable.toString(),
      });
    }
  }

  // ── Part 2: Resolve NEEDS_REVIEW TXNLWTVLGYL5N (HTTP_429, never processed) ──

  console.log("\n=== Part 2: Resolve NEEDS_REVIEW TXNLWTVLGYL5N ===");
  const nrTxn = await prisma.transaction.findUnique({
    where: { id: NEEDS_REVIEW_TXN_ID },
    select: FINALIZABLE_TXN_SELECT,
  });
  if (!nrTxn) {
    console.error("NEEDS_REVIEW txn not found!");
  } else {
    console.log("Status:", nrTxn.status, "| Amount:", nrTxn.amount.toString());
    if (nrTxn.status !== "NEEDS_REVIEW") {
      console.log("Not in NEEDS_REVIEW, skipping. Current status:", nrTxn.status);
    } else {
      // HTTP_429 = rate limited, provider never processed it. Safe to refund.
      const result = await finalizeServiceTransaction({
        txn: nrTxn,
        status: "FAILED",
        errorCode: "PROVIDER_RATE_LIMITED",
        errorMessage: "Payment was rate-limited by the provider and never processed — refunded.",
        source: "admin_resolve_429",
      });
      console.log("Finalized:", result);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
