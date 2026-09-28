/**
 * ONE-OFF: reconcile the settlement entry for the 27-Sep ROHIT SONI failed swipe
 * (SDPOS:43136393:000000000295). The money was already manually clawed back
 * ("[PULL] FUND_LOAD: Wrong Settlement"); this only flips the stale SETTLED entry
 * to REVERSED via the sanctioned handlePosReversal path. It MOVES NO MONEY
 * (handlePosReversal never debits — a settled entry is just flagged/flipped).
 * Idempotent: re-runs return ALREADY_REVERSED.
 *
 * DRY-RUN by default. APPLY=1 to write.
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
for (const file of [".env.local", ".env"]) {
  const p = resolve(process.cwd(), file);
  if (!existsSync(p)) continue;
  for (const raw of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
const REF = "SDPOS:43136393:000000000295";
const APPLY = process.env.APPLY === "1";

(async () => {
  const { prisma } = await import("../src/lib/db");
  const before = await prisma.posSettlementEntry.findUnique({ where: { transactionRef: REF }, select: { status: true, walletTxnId: true } });
  console.log(`entry BEFORE: status=${before?.status} walletTxnId=${before?.walletTxnId}`);

  if (!APPLY) {
    console.log("\nDRY-RUN. Would call handlePosReversal(status=FAILED) → entry SETTLED→REVERSED (no money moved). Re-run with APPLY=1.");
    await prisma.$disconnect();
    return;
  }

  const { handlePosReversal } = await import("../src/lib/settlement/pos");
  const result = await handlePosReversal({
    transactionRef: REF,
    status: "FAILED",
    reason: "pinelab:FAILED — failed swipe wrongly settled; money manually clawed back (Wrong Settlement). Reconciling stale entry.",
    source: "MANUAL",
  });
  console.log(`\nhandlePosReversal → ${JSON.stringify(result)}`);

  const after = await prisma.posSettlementEntry.findUnique({ where: { transactionRef: REF }, select: { status: true, reversedAt: true, reversalReason: true } });
  console.log(`entry AFTER: status=${after?.status} reversedAt=${after?.reversedAt?.toISOString()} reason=${after?.reversalReason}`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
