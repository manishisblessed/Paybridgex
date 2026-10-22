/**
 * One-off correction: reverse a payout that was FALSELY marked SUCCESS using a
 * mis-attributed rail reference.
 *
 * Context: payout cmvhttfmm000q60o5qfef6oe9 (₹49,995) went INDETERMINATE and
 * was never actually disbursed by SameDay. A manual recovery wrongly linked it
 * to SameDay's ₹49,996 transaction (UTR 629413975186) — which really belongs to
 * a DIFFERENT payout (cmvhtetb4000913stybanedns). That bypassed the built-in
 * "unclaimed reference" guard, so the ₹49,995 payout was captured (user debited)
 * for money that never left.
 *
 * This script reverses it via the app's own idempotent reversePayout() path
 * (creditWallet refund + margin clawback), then clears the wrong reference/UTR
 * so the real owner (banedns) is the sole holder of that UTR.
 *
 * Run (from the IP-whitelisted EC2 box):
 *   npx tsx scripts/reverse-misattributed-payout.ts
 */

const WRONG_PAYOUT_ID = "cmvhttfmm000q60o5qfef6oe9"; // ₹49,995 — never disbursed
const REAL_OWNER_ID = "cmvhtetb4000913stybanedns"; // ₹49,996 — real owner of the UTR
const SHARED_REF = "PSV2_9ce66cd7-c011-4e7b-b859-40e6b79a222f_1792569189871";

async function main() {
  const { prisma } = await import("@/lib/db");
  const { reversePayout } = await import("@/lib/payout/service");

  // ── Safety checks before touching money ──────────────────────────────────
  const wrong = await prisma.payoutRequest.findUnique({ where: { id: WRONG_PAYOUT_ID } });
  const real = await prisma.payoutRequest.findUnique({ where: { id: REAL_OWNER_ID } });

  if (!wrong) throw new Error(`Payout ${WRONG_PAYOUT_ID} not found`);
  if (!real) throw new Error(`Real owner ${REAL_OWNER_ID} not found`);

  console.log("── BEFORE ──");
  console.log(`  WRONG payout ${WRONG_PAYOUT_ID}: status=${wrong.status} amount=${Number(wrong.amount)} ref=${wrong.providerTxnId} utr=${wrong.utr}`);
  console.log(`  REAL  payout ${REAL_OWNER_ID}: status=${real.status} amount=${Number(real.amount)} ref=${real.providerTxnId} utr=${real.utr}`);

  // Guard 1: the wrong payout must currently be SUCCESS (the state we're undoing).
  if (wrong.status !== "SUCCESS") {
    console.log(`\n⚠️  Payout ${WRONG_PAYOUT_ID} is ${wrong.status}, not SUCCESS. Nothing to reverse. Aborting.`);
    return;
  }

  // Guard 2: confirm the two payouts really do share the same (mis-attributed) ref.
  if (wrong.providerTxnId !== SHARED_REF || real.providerTxnId !== SHARED_REF) {
    console.log(`\n⚠️  Reference mismatch — expected both to hold ${SHARED_REF}. Aborting to avoid a wrong correction.`);
    return;
  }

  // Guard 3: the real owner must remain SUCCESS (we are NOT touching it).
  if (real.status !== "SUCCESS") {
    console.log(`\n⚠️  Real owner ${REAL_OWNER_ID} is ${real.status}, not SUCCESS. Unexpected — aborting.`);
    return;
  }

  // ── Reverse the false success (refunds totalDebit to the user) ────────────
  console.log("\n── REVERSING ──");
  const res = await reversePayout(WRONG_PAYOUT_ID, {
    reason:
      "Correction: rail reference was mis-attributed (belongs to payout " +
      REAL_OWNER_ID +
      "). SameDay never disbursed this ₹49,995 transfer — refunding the wrongful capture.",
    response: { correction: true, misattributedRef: SHARED_REF, realOwner: REAL_OWNER_ID },
  });
  console.log(`  reversePayout → reversed=${res.reversed}`);

  // ── Clear the wrong reference/UTR so banedns is the sole owner ─────────────
  if (res.reversed) {
    await prisma.payoutRequest.updateMany({
      where: { id: WRONG_PAYOUT_ID, status: "REVERSED" },
      data: { providerTxnId: null, utr: null },
    });
    console.log("  cleared mis-attributed providerTxnId + utr from the reversed payout");
  }

  // ── AFTER ─────────────────────────────────────────────────────────────────
  const wrongAfter = await prisma.payoutRequest.findUnique({ where: { id: WRONG_PAYOUT_ID } });
  const realAfter = await prisma.payoutRequest.findUnique({ where: { id: REAL_OWNER_ID } });
  console.log("\n── AFTER ──");
  console.log(`  WRONG payout ${WRONG_PAYOUT_ID}: status=${wrongAfter?.status} ref=${wrongAfter?.providerTxnId} utr=${wrongAfter?.utr}`);
  console.log(`  REAL  payout ${REAL_OWNER_ID}: status=${realAfter?.status} ref=${realAfter?.providerTxnId} utr=${realAfter?.utr}`);
  console.log(`\n✅ Done. ₹${Number(wrong.totalDebit)} refunded to the user's wallet (REVERSAL credit).`);

  await prisma.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("ERROR:", e);
    process.exit(1);
  });
