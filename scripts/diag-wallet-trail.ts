/**
 * READ-ONLY wallet money-trail for a SINGLE service transaction.
 *
 * Answers the one question that decides how to correct a wrongly-FAILED payment:
 * what actually happened to the retailer's money? Did we debit the reserve at
 * initiation, and was it EVER credited back (a refund) — under ANY key, not just
 * the current `txn:<user>:<ref>:reversal` one that newer code uses?
 *
 * This matters because a row failed by OLDER code may have been refunded under a
 * different key, which the corrective finalizer's refund-detection would miss —
 * and promoting it to SUCCESS without a clawback would hand the retailer free
 * money. Conversely, if the reserve was debited and NEVER returned, correcting to
 * SUCCESS with NO lien is exactly right (the retailer correctly paid).
 *
 * Never writes, never moves money. Only reads WalletTxn / WalletLien / balances.
 *
 * Usage:  REF=TXN7H58YLAMOT ./node_modules/.bin/tsx scripts/diag-wallet-trail.ts
 */
import "./_load-env";
import { prisma } from "../src/lib/db";

const REF = (process.env.REF ?? "").trim();

async function main() {
  if (!REF) {
    console.error("Set REF=TXN...  e.g.  REF=TXN7H58YLAMOT ./node_modules/.bin/tsx scripts/diag-wallet-trail.ts");
    process.exit(1);
  }

  const txn = await prisma.transaction.findFirst({
    where: { OR: [{ refId: REF }, { partnerTxnId: REF }] },
    select: {
      id: true, refId: true, userId: true, service: true, partner: true,
      status: true, amount: true, fee: true, createdAt: true,
    },
  });
  if (!txn) { console.error(`No transaction found for ${REF}`); process.exit(1); }

  const reserve = Number(txn.amount) + Number(txn.fee);
  console.log(`\n=== TXN ${txn.refId} ===`);
  console.log(`user        : ${txn.userId}`);
  console.log(`service/part: ${txn.service} / ${txn.partner}`);
  console.log(`status      : ${txn.status}`);
  console.log(`amount/fee  : ${txn.amount} / ${txn.fee}  (reserve ${reserve})`);
  console.log(`created     : ${txn.createdAt.toISOString()}`);

  // Every ledger row that references this txn — by the durable refType/refId link
  // OR by the refId string appearing in the idempotency key / note (older paths).
  const rows = await prisma.walletTxn.findMany({
    where: {
      userId: txn.userId,
      OR: [
        { refType: "Transaction", refId: txn.id },
        { refId: txn.id },
        { idempotencyKey: { contains: txn.refId } },
        { note: { contains: txn.refId } },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: {
      createdAt: true, walletType: true, direction: true, reason: true,
      amount: true, balanceAfter: true, refType: true, refId: true,
      idempotencyKey: true, note: true,
    },
  });

  console.log(`\n--- WalletTxn rows referencing this txn: ${rows.length} ---`);
  let debit = 0;
  let credit = 0;
  for (const r of rows) {
    const amt = Number(r.amount);
    if (r.direction === "DEBIT") debit += amt;
    else credit += amt;
    console.log(
      `  [${r.createdAt.toISOString()}] ${r.walletType} ${r.direction} ${r.reason} ${r.amount}` +
        `  balAfter=${r.balanceAfter}\n` +
        `     key=${r.idempotencyKey ?? "-"}  note=${r.note ?? "-"}`
    );
  }
  console.log(`\n  totals: DEBIT=${debit}  CREDIT=${credit}  net(debit-credit)=${debit - credit}`);

  // Interpretation hint.
  const netCharged = debit - credit;
  console.log(`\n--- interpretation ---`);
  if (rows.length === 0) {
    console.log(`  ⚠️  No ledger rows at all — the reserve may never have been debited.`);
  } else if (Math.abs(netCharged - reserve) < 0.01) {
    console.log(`  ✅ Retailer is NET-DEBITED the full reserve (${reserve}) and was NOT refunded.`);
    console.log(`     → Correcting to SUCCESS needs NO clawback lien (they correctly paid).`);
  } else if (Math.abs(netCharged) < 0.01) {
    console.log(`  ⚠️  Retailer was DEBITED then fully CREDITED back (net 0) — i.e. REFUNDED.`);
    console.log(`     → Correcting to SUCCESS MUST claw back ${reserve} via a lien.`);
    console.log(`     → The corrective finalizer detects this refund by the durable REVERSAL`);
    console.log(`        link (reason=REVERSAL, refType/refId → this txn), so CONFIRM=1 will`);
    console.log(`        place the clawback lien automatically.`);
  } else {
    console.log(`  ⚠️  Partial/odd net (${netCharged}) vs reserve (${reserve}) — inspect rows above.`);
  }

  // Current wallet + any liens.
  const user = await prisma.user.findUnique({
    where: { id: txn.userId },
    select: { email: true, walletBalance: true, heldBalance: true, lienBalance: true },
  });
  console.log(`\n--- retailer wallet now ---`);
  console.log(`  ${user?.email}`);
  console.log(`  walletBalance=${user?.walletBalance}  heldBalance=${user?.heldBalance}  lienBalance=${user?.lienBalance}`);

  const liens = await prisma.walletLien.findMany({
    where: { targetUserId: txn.userId },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, amount: true, recoveredAmount: true, status: true, reasonCode: true, refId: true, createdAt: true },
  });
  console.log(`\n--- recent liens on retailer: ${liens.length} ---`);
  for (const l of liens) {
    console.log(
      `  [${l.createdAt.toISOString()}] ${l.status} ${l.reasonCode} amount=${l.amount} recovered=${l.recoveredAmount} refId=${l.refId ?? "-"} (${l.id})`
    );
  }

  console.log(`\n=== end ===\n`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
