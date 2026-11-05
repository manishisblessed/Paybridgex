/**
 * One-off: place a lien to recover the wrongly-refunded amount from
 * txn TXNP8GNQLTQV9 (Bill Credit Card ₹25,150 + ₹29.50 fee = ₹25,179.50).
 *
 * The system auto-refunded this PENDING payment; the provider may still
 * confirm SUCCESS. This lien ensures the refunded amount is recovered
 * from the retailer's wallet (eagerly from available balance, then from
 * future credits — never drives the wallet negative).
 *
 * Usage (from the EC2): cd ~/paybridgex && npx tsx scripts/recover-txn.ts
 */
import { prisma } from "@/lib/db";
import { placeWalletLien } from "@/lib/wallet/lien";
import { getBalances } from "@/lib/ledger";

const TXN_REF_ID = "TXNP8GNQLTQV9";
const TXN_ID = "cmw0nh7kv00bc1kje9rjz271y";
const USER_ID = "cmuvbnmvm0023rc8nul1vepvx";
const REFUND_AMOUNT = 25179.50; // amount + fee that was auto-refunded

async function main() {
  // 1. Verify the transaction exists and is still FAILED
  const txn = await prisma.transaction.findUnique({
    where: { id: TXN_ID },
    select: { id: true, refId: true, status: true, amount: true, fee: true, userId: true },
  });
  if (!txn) { console.error("Transaction not found!"); process.exit(1); }
  console.log("Transaction:", txn.refId, "Status:", txn.status, "Amount:", txn.amount.toString(), "Fee:", txn.fee.toString());

  if (txn.status !== "FAILED") {
    console.error("Transaction is not FAILED (status: " + txn.status + "). Aborting.");
    process.exit(1);
  }

  // 2. Check existing liens on this transaction
  const existingLien = await prisma.walletLien.findFirst({
    where: { refType: "Transaction", refId: TXN_ID, status: "ACTIVE" },
  });
  if (existingLien) {
    console.error("A lien already exists for this transaction:", existingLien.id);
    process.exit(1);
  }

  // 3. Show current wallet balance
  const balBefore = await getBalances(USER_ID);
  console.log("\nWallet BEFORE:", {
    balance: balBefore.walletBalance.toString(),
    held: balBefore.heldBalance.toString(),
    lien: balBefore.lienBalance.toString(),
    spendable: balBefore.spendable.toString(),
  });

  // 4. Place the lien
  console.log("\nPlacing lien for ₹" + REFUND_AMOUNT + "...");
  const lien = await placeWalletLien({
    actorId: USER_ID, // system-initiated recovery, linked to the txn
    targetUserId: USER_ID,
    amount: REFUND_AMOUNT,
    reasonCode: "OTHER",
    remarks: "Recovery of auto-refunded txn " + TXN_REF_ID + " — provider payment still PENDING, refund was premature. Provider-confirmed outcome will determine final resolution.",
    refType: "Transaction",
    refId: TXN_ID,
  });

  console.log("\nLien placed!", {
    lienId: lien.id,
    amount: lien.amount.toString(),
    recovered: lien.recoveredAmount.toString(),
    status: lien.status,
  });

  // 5. Show wallet balance after
  const balAfter = await getBalances(USER_ID);
  console.log("\nWallet AFTER:", {
    balance: balAfter.walletBalance.toString(),
    held: balAfter.heldBalance.toString(),
    lien: balAfter.lienBalance.toString(),
    spendable: balAfter.spendable.toString(),
  });

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
