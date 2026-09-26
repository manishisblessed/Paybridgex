/**
 * READ-ONLY: Inspect a single bill-payment transaction (BBPS/Pay2New OR
 * RechargeKit CC-2) and its LIVE provider status. Mutates NOTHING.
 *
 * Reports, for a given refId:
 *   1. The internal DB row (status, partner, partnerTxnId, amounts, timestamps).
 *   2. The raw stored `request` / `response` JSON.
 *   3. Every provider reference we could poll with (partnerTxnId + any
 *      order_id / request_id / bill_fetch_ref / txn_id mined from request+response).
 *   4. The AUTHORITATIVE live provider status for each of those refs, using the
 *      correct rail for the row's partner.
 *   5. A diagnosis of why it may still be stuck in PROCESSING.
 *
 * Run on server:
 *   REF=TXNL9SQOBIL_D ./node_modules/.bin/tsx scripts/check-bill-txn.ts
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

function loadEnvFile(): void {
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
}
loadEnvFile();

const REF = (process.env.REF ?? "TXNL9SQOBIL_D").trim();
const STUCK_THRESHOLD_MS = 60 * 60_000; // mirror the recon sweeps
const RK_PARTNER = "SAMEDAY_RECHARGEKIT";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : "—");
const inr = (n: unknown) =>
  "₹" + Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ageStr = (ms: number) => `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;

/** Mine any provider reference id out of an arbitrary stored JSON blob. */
function mineRefs(...blobs: unknown[]): string[] {
  const keys = [
    "order_id", "orderId", "request_id", "requestId",
    "txn_id", "txnId", "bill_fetch_ref", "billFetchRef",
    "operator_reference", "operatorReference",
  ];
  const out: string[] = [];
  for (const blob of blobs) {
    if (!blob || typeof blob !== "object") continue;
    const r = blob as Record<string, unknown>;
    for (const k of keys) {
      const v = r[k];
      if (typeof v === "string" && v.trim().length > 0) out.push(v.trim());
    }
    // one level deep (e.g. nested `data: { order_id }`)
    for (const v of Object.values(r)) {
      if (v && typeof v === "object") {
        const nested = v as Record<string, unknown>;
        for (const k of keys) {
          const nv = nested[k];
          if (typeof nv === "string" && nv.trim().length > 0) out.push(nv.trim());
        }
      }
    }
  }
  return Array.from(new Set(out));
}

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { flags } = await import("../src/lib/env");
  const { getPartner } = await import("../src/lib/partners");

  console.log(`\n=== Bill-payment status check for refId=${REF} ===\n`);

  const txn = await prisma.transaction.findUnique({
    where: { refId: REF },
    select: {
      id: true, refId: true, userId: true, service: true, status: true,
      amount: true, fee: true, gst: true, vendorCharge: true, priceScope: true,
      customer: true, operator: true, partner: true, partnerTxnId: true,
      errorCode: true, errorMessage: true, request: true, response: true,
      createdAt: true, updatedAt: true, refundedAt: true,
      user: { select: { name: true, userCode: true, walletBalance: true, heldBalance: true } },
    },
  });

  if (!txn) {
    console.log(`✗ No transaction found with refId=${REF}`);
    await prisma.$disconnect();
    return;
  }

  const ageMs = Date.now() - txn.createdAt.getTime();
  console.log(`--- INTERNAL DB ROW ---`);
  console.log(`retailer     : ${txn.user?.name ?? "?"} (${txn.user?.userCode ?? "?"})  userId=${txn.userId}`);
  console.log(`wallet now   : balance=${inr(txn.user?.walletBalance)}  held=${inr(txn.user?.heldBalance)}`);
  console.log(`service      : ${txn.service}   partner: ${txn.partner ?? "—"}   priceScope: ${txn.priceScope ?? "—"}`);
  console.log(`STATUS       : ${txn.status}`);
  console.log(`amount       : ${inr(txn.amount)}   fee: ${inr(txn.fee)}   gst: ${inr(txn.gst)}   vendorCharge: ${inr(txn.vendorCharge)}`);
  console.log(`reserve held : ${inr(Number(txn.amount) + Number(txn.fee))}`);
  console.log(`customer     : ${txn.customer ?? "—"}   operator: ${txn.operator ?? "—"}`);
  console.log(`partnerTxnId : ${txn.partnerTxnId ?? "(blank)"}`);
  console.log(`error        : ${txn.errorCode ?? "—"}  ${txn.errorMessage ?? ""}`);
  console.log(`createdAt    : ${iso(txn.createdAt)}   (age ${ageStr(ageMs)})`);
  console.log(`updatedAt    : ${iso(txn.updatedAt)}   ${txn.updatedAt.getTime() === txn.createdAt.getTime() ? "(NEVER UPDATED since creation)" : ""}`);
  console.log(`refundedAt   : ${iso(txn.refundedAt)}`);

  console.log(`\n--- RAW request JSON ---\n${JSON.stringify(txn.request, null, 2)}`);
  console.log(`\n--- RAW response JSON ---\n${JSON.stringify(txn.response, null, 2)}`);

  if (["SUCCESS", "FAILED", "REFUNDED"].includes(txn.status)) {
    console.log(`\n✓ Row is already TERMINAL (${txn.status}) in the DB. Any "Pending" in the UI is stale.`);
    await prisma.$disconnect();
    return;
  }

  // Candidate poll refs: partnerTxnId + anything mined from request/response.
  const mined = mineRefs(txn.request, txn.response);
  const refs = Array.from(
    new Set([txn.partnerTxnId ?? "", ...mined].map((s) => (s ?? "").trim()).filter(Boolean))
  );
  console.log(`\n--- POLL CANDIDATES ---`);
  console.log(`partnerTxnId    : ${txn.partnerTxnId ?? "(blank)"}`);
  console.log(`mined from JSON : ${mined.length ? mined.join(", ") : "(none)"}`);
  console.log(`effective       : ${refs.length ? refs.join(", ") : "(NONE — UNPOLLABLE)"}`);

  const isRk = txn.partner === RK_PARTNER;
  const railName = isRk ? "RechargeKit (CC-2)" : "BBPS / Pay2New";
  console.log(`\nrail            : ${railName}   (bbps flag=${flags.bbps ? "on" : "off"}, rechargekit flag=${flags.rechargekit ? "on" : "off"})`);

  if (refs.length === 0) {
    console.log(`\n✗ DIAGNOSIS: No provider reference to poll (blank partnerTxnId + nothing`);
    console.log(`  in request/response JSON). The pay call never returned an order_id/`);
    console.log(`  request_id, so the recon DRAIN stage (which requires partnerTxnId) can`);
    console.log(`  NEVER poll this row — it will sit in PROCESSING until manually resolved.`);
    console.log(`  → The reserve of ${inr(Number(txn.amount) + Number(txn.fee))} is still held on the retailer's wallet.`);
    console.log(`  → NEXT STEP: look up ${REF} in the Same Day / Pay2New partner dashboard by`);
    console.log(`    OUR client reference. If they have no record → it never debited → refund`);
    console.log(`    the reserve (FAILED). If they show a terminal state → finalize to match.`);
    await prisma.$disconnect();
    return;
  }

  // Poll the correct rail, read-only.
  console.log(`\n--- LIVE PROVIDER STATUS (read-only) ---`);
  let terminalSeen: string | null = null;

  if (isRk) {
    const { rechargekitConfigured, rechargekitStatus } = await import("../src/lib/partners/sameday-rechargekit");
    if (!flags.rechargekit || !rechargekitConfigured()) {
      console.log(`✗ RechargeKit rail disabled/unconfigured in this .env.`);
    } else {
      for (const ref of refs) {
        let r = await rechargekitStatus({ txnId: ref });
        if (!r.ok) r = await rechargekitStatus({ requestId: ref });
        if (!r.ok) { console.log(`ref=${ref} → poll FAILED code=${r.code} ${r.message ?? ""}`); continue; }
        console.log(`ref=${ref} → provider status=${r.data.status} amount=${inr(r.data.amount)} opRef=${r.data.operatorReference ?? "—"}`);
        if (["SUCCESS", "FAILED", "REFUNDED"].includes(r.data.status)) terminalSeen = r.data.status;
      }
    }
  } else {
    if (!flags.bbps) {
      console.log(`✗ BBPS/Pay2New rail disabled in this .env (PARTNER_BBPS_ENABLED=false).`);
    } else {
      const bbps = getPartner("bbps");
      if (!bbps.status) {
        console.log(`✗ BBPS provider has no status() method.`);
      } else {
        for (const ref of refs) {
          let r = await bbps.status({ orderId: ref });
          if (!r.ok) r = await bbps.status({ requestId: ref });
          if (!r.ok) { console.log(`ref=${ref} → poll FAILED code=${r.code} ${r.message ?? ""}`); continue; }
          console.log(`ref=${ref} → provider status=${r.data.status} opRef=${r.data.operatorRef ?? "—"}`);
          if (["SUCCESS", "FAILED", "REFUNDED"].includes(r.data.status)) terminalSeen = r.data.status;
        }
      }
    }
  }

  console.log(`\n--- DIAGNOSIS ---`);
  if (terminalSeen) {
    console.log(`⚠ Provider reports TERMINAL (${terminalSeen}) but the DB row is still ${txn.status}.`);
    console.log(`  A missed webhook + un-pollable recon left it stranded. Finalize it (settle`);
    console.log(`  or refund the ${inr(Number(txn.amount) + Number(txn.fee))} reserve) to match the provider.`);
    console.log(`  (This script is read-only and did NOT change the row.)`);
  } else if (ageMs > STUCK_THRESHOLD_MS) {
    console.log(`⚠ Still PENDING after ${ageStr(ageMs)} (> 1h stuck threshold) — should have`);
    console.log(`  raised an ops alert. Escalate to the ${railName} provider with ref ${REF}.`);
  } else {
    console.log(`Provider still PENDING and within the normal settle window — let the 5-min`);
    console.log(`recon sweep / webhook finalize it.`);
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
