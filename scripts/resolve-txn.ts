/**
 * CORRECTIVE one-off resolver for a SINGLE service transaction.
 *
 * Fixes the direct-financial-loss case: a bill payment the provider actually
 * COMPLETED but PaybridgeX recorded as FAILED (and auto-refunded) before the
 * NEEDS_REVIEW hold shipped. It RE-VERIFIES the outcome against SameDay's
 * bill/status API (now keyed on the bill_fetch_ref we always retain), and only
 * if the provider confirms SUCCESS does it promote the row to SUCCESS and claw
 * back the refund via a LIEN (never drives the wallet negative).
 *
 * SAFE BY DEFAULT: dry-run unless CONFIRM=1. Dry-run moves no money — it just
 * prints the provider's authoritative status for every candidate reference.
 *
 * Usage (on the IP-whitelisted EC2 box):
 *   # 1) dry run — see what the provider says, no money moves:
 *   REF=TXN7H58YLAMOT ./node_modules/.bin/tsx scripts/resolve-txn.ts
 *   # 2) execute — API-verified settle + lien clawback:
 *   REF=TXN7H58YLAMOT CONFIRM=1 ./node_modules/.bin/tsx scripts/resolve-txn.ts
 *
 * Optional:
 *   ACTOR=<userId>     admin user recorded on the lien/audit (defaults to a
 *                      MASTER_ADMIN found in the DB)
 *   PROVIDER_REF=<id>  pay-step order_id/request_id, only if status can't resolve
 */
import "./_load-env";
import { prisma } from "../src/lib/db";
import { deriveTxnRefs } from "../src/lib/recon/refs";
import { recoverRefsFromApiLog } from "../src/lib/recon/recover";
import { getPartner } from "../src/lib/partners";
import { correctOneTransaction } from "../src/lib/recon/reconcileOne";

const REF = (process.env.REF ?? "").trim();
const CONFIRM = process.env.CONFIRM === "1";
const ACTOR = (process.env.ACTOR ?? "").trim();
const PROVIDER_REF = (process.env.PROVIDER_REF ?? "").trim();

async function main() {
  if (!REF) {
    console.error("Set REF=TXN...  e.g.  REF=TXN7H58YLAMOT ./node_modules/.bin/tsx scripts/resolve-txn.ts");
    process.exit(1);
  }

  const txn = await prisma.transaction.findFirst({
    where: { OR: [{ refId: REF }, { partnerTxnId: REF }] },
    select: {
      id: true, refId: true, service: true, partner: true, status: true,
      partnerTxnId: true, amount: true, fee: true, request: true, response: true,
    },
  });
  if (!txn) { console.error(`No transaction found for ${REF}`); process.exit(1); }

  console.log(`\n=== ${txn.refId} ===`);
  console.log(`service/partner : ${txn.service} / ${txn.partner}`);
  console.log(`current status  : ${txn.status}`);
  console.log(`amount/fee      : ${txn.amount} / ${txn.fee}`);

  // Candidate references — bill_fetch_ref is now a valid bill/status key.
  const refs = Array.from(
    new Set(
      [
        PROVIDER_REF,
        ...deriveTxnRefs({ partnerTxnId: txn.partnerTxnId, request: txn.request, response: txn.response }),
        ...(await recoverRefsFromApiLog(txn.refId)),
      ].filter(Boolean)
    )
  );
  console.log(`candidate refs  : ${JSON.stringify(refs)}`);

  // Always show the provider's authoritative answer first (read-only).
  console.log(`\n--- provider bill/status (read-only) ---`);
  const bbps = getPartner("bbps");
  if (bbps.status) {
    for (const ref of refs) {
      let r = await bbps.status({ orderId: ref });
      if (!r.ok) r = await bbps.status({ requestId: ref });
      if (!r.ok) r = await bbps.status({ billFetchRef: ref });
      console.log(`  ref=${ref} -> ${r.ok ? `status=${r.data.status} payRef=${r.data.orderId ?? r.data.requestId ?? "-"}` : `NOT RESOLVED (${r.code})`}`);
    }
  }

  if (!CONFIRM) {
    console.log(`\nDRY RUN — no money moved. Re-run with CONFIRM=1 to execute the correction.\n`);
    await prisma.$disconnect();
    return;
  }

  // Resolve the admin actor for the lien/audit trail.
  let actorId = ACTOR;
  if (!actorId) {
    const admin = await prisma.user.findFirst({
      where: { role: "MASTER_ADMIN", deletedAt: null },
      select: { id: true, email: true },
    });
    if (!admin) { console.error("No MASTER_ADMIN user found — set ACTOR=<userId>."); process.exit(1); }
    actorId = admin.id;
    console.log(`\nactor           : ${admin.email} (${admin.id})`);
  }

  console.log(`\nExecuting API-verified correction...`);
  const result = await correctOneTransaction(txn.refId, {
    actorId,
    providerRef: PROVIDER_REF || undefined,
    source: "admin_resolve_script",
  });

  console.log(`\n=== RESULT ===`);
  console.log(JSON.stringify(result, null, 2));
  if (result.found && result.outcome === "corrected") {
    console.log(
      `\n✅ Corrected to SUCCESS. Clawback: placed=${result.clawback?.placed} refunded=${result.clawback?.refunded} lienId=${result.clawback?.lienId}`
    );
  } else if (result.found && result.outcome === "unresolved") {
    console.log(`\n⚠️  Provider could not confirm from any ref. Read the pay-step order_id from the SameDay panel and re-run with PROVIDER_REF=<id> CONFIRM=1.`);
  } else {
    console.log(`\nOutcome: ${result.found ? result.outcome : "not_found"} (no correction applied).`);
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
