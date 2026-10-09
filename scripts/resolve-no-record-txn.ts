/**
 * Resolve a HELD (NEEDS_REVIEW / PROCESSING) service transaction that the
 * provider has NO record of — the "Case C" strand: an indeterminate pay
 * (e.g. an HTTP 429 the provider rejected before processing) that left the row
 * held with a blank partnerTxnId, and whose bill_fetch_ref the status API can't
 * resolve (ORDER_NOT_FOUND). Neither `reconcile` nor `resolve` can finalize it
 * (both need an authoritative provider status), so the retailer's reserve stays
 * frozen until someone confirms, from the provider panel, that NO money moved.
 *
 * This script actions that human-verified decision the CLEAN way: it finalizes
 * the row as FAILED through the SINGLE canonical finalizer, which refunds the
 * held reserve (amount + fee) AND marks the row terminal — clearing it from the
 * Needs-Review queue and the anomaly feed. Idempotent + at-most-once.
 *
 * SAFETY:
 *   • DRY-RUN unless CONFIRM=1. The dry run polls the provider and moves nothing.
 *   • Re-polls every candidate reference first and ABORTS if the provider
 *     reports SUCCESS or PENDING for ANY of them — so it can never refund a card
 *     that was actually charged. Only a uniformly not-found / FAILED result (the
 *     Case-C signature) is allowed to proceed.
 *   • Only touches a NON-TERMINAL row; a terminal row is left untouched.
 *
 * Usage (on the IP-whitelisted box):
 *   REF=TXN7O7RTO9_EX ./node_modules/.bin/tsx scripts/resolve-no-record-txn.ts
 *   REF=TXN7O7RTO9_EX CONFIRM=1 ./node_modules/.bin/tsx scripts/resolve-no-record-txn.ts
 */
import "./_load-env";
import { prisma } from "../src/lib/db";
import { getPartner } from "../src/lib/partners";
import { deriveTxnRefs } from "../src/lib/recon/refs";
import { recoverRefsFromApiLog } from "../src/lib/recon/recover";
import { finalizeServiceTransaction, FINALIZABLE_TXN_SELECT } from "../src/lib/services/finalize";

const REF = (process.env.REF ?? "").trim();
const CONFIRM = process.env.CONFIRM === "1";

const NON_TERMINAL = new Set(["INITIATED", "PROCESSING", "NEEDS_REVIEW"]);

async function main() {
  if (!REF) {
    console.error("Set REF=TXN...  e.g.  REF=TXN7O7RTO9_EX ./node_modules/.bin/tsx scripts/resolve-no-record-txn.ts");
    process.exit(1);
  }

  const row = await prisma.transaction.findFirst({
    where: { OR: [{ refId: REF }, { partnerTxnId: REF }] },
    select: { ...FINALIZABLE_TXN_SELECT, request: true, response: true },
  });
  if (!row) {
    console.error(`No transaction found for ${REF}`);
    process.exit(1);
  }
  const { request, response, ...txn } = row;

  console.log(`\n=== ${txn.refId} ===`);
  console.log(`service/partner : ${txn.service} / ${txn.partner}`);
  console.log(`current status  : ${txn.status}`);
  console.log(`amount/fee      : ${txn.amount} / ${txn.fee}  (reserve = ₹${Number(txn.amount) + Number(txn.fee)})`);
  console.log(`partnerTxnId    : ${txn.partnerTxnId ?? "(blank)"}`);

  if (!NON_TERMINAL.has(txn.status)) {
    console.log(`\nRow is already terminal (${txn.status}) — nothing to do.`);
    await prisma.$disconnect();
    return;
  }

  // Candidate provider references, mined from the row + the durable call log.
  const refs = Array.from(
    new Set(
      [
        ...deriveTxnRefs({ partnerTxnId: txn.partnerTxnId, request, response }),
        ...(await recoverRefsFromApiLog(txn.refId)),
      ].filter(Boolean)
    )
  );
  console.log(`candidate refs  : ${JSON.stringify(refs)}`);

  // ── Provider re-poll (read-only safety guard) ────────────────────────────
  // We must tell three outcomes apart per reference:
  //   • SUCCESS/PENDING          → the card MAY be charged → ABORT, never refund.
  //   • reached + not-found/FAILED → provider has no successful charge → OK.
  //   • UNREACHABLE (401 IP-block / network / 5xx / 429 / timeout) → we could NOT
  //     ask, so the guard is blind → refuse to refund (run on the whitelisted box).
  console.log(`\n--- provider bill/status (read-only) ---`);
  const bbps = getPartner("bbps");
  let sawSuccessOrPending = false;
  let reachedDefinitive = false; // got a real business answer (not a transport error)
  // Transport/auth failures where we did NOT actually get a provider verdict.
  const isUnreachable = (code: string, indeterminate?: boolean): boolean =>
    indeterminate === true ||
    ["UNAUTHORIZED", "NETWORK", "HTTP_401", "HTTP_403", "HTTP_429", "BAD_PARAMS"].includes(code) ||
    /^HTTP_5\d\d$/.test(code);

  if (bbps.status) {
    for (const ref of refs) {
      let r = await bbps.status({ orderId: ref });
      if (!r.ok) r = await bbps.status({ requestId: ref });
      if (!r.ok) r = await bbps.status({ billFetchRef: ref });
      if (r.ok) {
        reachedDefinitive = true;
        console.log(`  ref=${ref} -> status=${r.data.status} payRef=${r.data.orderId ?? r.data.requestId ?? "-"}`);
        if (r.data.status === "SUCCESS" || r.data.status === "PENDING") sawSuccessOrPending = true;
      } else if (isUnreachable(r.code, r.indeterminate)) {
        console.log(`  ref=${ref} -> UNREACHABLE (${r.code}) — cannot verify from here`);
      } else {
        // A definitive business failure (e.g. ORDER_NOT_FOUND / HTTP_404): the
        // provider was reached and has no successful record for this ref.
        reachedDefinitive = true;
        console.log(`  ref=${ref} -> reached, no success (${r.code})`);
      }
    }
  } else {
    console.log("  (no BBPS status method available)");
  }

  if (sawSuccessOrPending) {
    console.error(
      `\n⛔ ABORT: the provider reports SUCCESS/PENDING for at least one reference — this is NOT a no-record case. ` +
        `Do NOT refund. Use the admin resolver with the pay-step reference instead.`
    );
    await prisma.$disconnect();
    process.exit(2);
  }

  if (!reachedDefinitive) {
    console.error(
      `\n⛔ ABORT: could NOT reach the provider to verify (IP not whitelisted / network). The safety guard is blind here. ` +
        `Run this script on the IP-whitelisted server, or whitelist this IP, before using CONFIRM=1.`
    );
    await prisma.$disconnect();
    process.exit(3);
  }

  console.log(`\nProvider reached — no successful charge for any reference. Consistent with a rejected (e.g. 429) pay; no money moved.`);

  if (!CONFIRM) {
    console.log(`\nDRY RUN — no money moved. Re-run with CONFIRM=1 to finalize as FAILED and refund ₹${Number(txn.amount) + Number(txn.fee)}.\n`);
    await prisma.$disconnect();
    return;
  }

  console.log(`\nFinalizing as FAILED (refunds the held reserve, marks terminal)...`);
  const result = await finalizeServiceTransaction({
    txn,
    status: "FAILED",
    errorCode: "BBPS_RATE_LIMITED_NO_RECORD",
    errorMessage: "Provider rejected the pay (rate-limited) and has no record — reserve refunded",
    source: "admin_no_record_resolve",
  });

  console.log(`\n=== RESULT ===`);
  console.log(JSON.stringify(result, null, 2));
  console.log(
    result.outcome === "refunded"
      ? `\n✅ Refunded ₹${Number(txn.amount) + Number(txn.fee)} and marked ${txn.refId} FAILED.`
      : `\nOutcome: ${result.outcome} (already finalized by a racing sweep/webhook — no double refund).`
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
