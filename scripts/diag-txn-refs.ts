/**
 * READ-ONLY deep inspector for a SINGLE service transaction.
 *
 * Dumps everything we need to understand why an automated status() poll can or
 * cannot resolve a payment at the provider after a lost/ambiguous pay response:
 *   • the Transaction row (status, errorCode, partnerTxnId, amount/fee)
 *   • the stored request/response JSON (PII masked)
 *   • every PartnerApiLog entry for this ref (the durable money-call log)
 *   • all derived poll references (from the row + from PartnerApiLog)
 *   • the RAW provider status() response for each reference (ok/code/message/raw)
 *
 * Never writes, never finalizes, never moves money. Only calls status().
 *
 * Usage:  REF=TXN7H58YLAMOT ./node_modules/.bin/tsx scripts/diag-txn-refs.ts
 */
import "./_load-env";
import { prisma } from "../src/lib/db";
import { deriveTxnRefs } from "../src/lib/recon/refs";
import { recoverRefsFromApiLog } from "../src/lib/recon/recover";

const REF = (process.env.REF ?? "").trim();
const RK_PARTNER = "SAMEDAY_RECHARGEKIT";

function mask(v: unknown): unknown {
  if (typeof v !== "string") return v;
  // Mask anything that looks like a 10-digit mobile → keep last 4.
  if (/^\d{10}$/.test(v)) return `******${v.slice(-4)}`;
  return v;
}
function maskObj(o: unknown): unknown {
  if (o == null || typeof o !== "object") return o;
  if (Array.isArray(o)) return o.map(maskObj);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (/mobile|phone|customer_number|customerNumber|optional1/i.test(k)) out[k] = mask(v);
    else if (v && typeof v === "object") out[k] = maskObj(v);
    else out[k] = v;
  }
  return out;
}

async function main() {
  if (!REF) {
    console.error("Set REF=TXN... e.g.  REF=TXN7H58YLAMOT ./node_modules/.bin/tsx scripts/diag-txn-refs.ts");
    process.exit(1);
  }

  const txn = await prisma.transaction.findFirst({
    where: { OR: [{ refId: REF }, { partnerTxnId: REF }] },
    select: {
      id: true, refId: true, service: true, partner: true, status: true,
      errorCode: true, errorMessage: true, partnerTxnId: true,
      amount: true, fee: true, operator: true, customer: true,
      request: true, response: true, createdAt: true, updatedAt: true,
    },
  });
  if (!txn) { console.error(`No transaction found for ${REF}`); process.exit(1); }

  console.log(`\n=== Transaction ${txn.refId} ===`);
  console.log(`service      : ${txn.service}`);
  console.log(`partner      : ${txn.partner}`);
  console.log(`status       : ${txn.status}`);
  console.log(`errorCode    : ${txn.errorCode}`);
  console.log(`errorMessage : ${txn.errorMessage}`);
  console.log(`partnerTxnId : ${txn.partnerTxnId ?? "(blank)"}`);
  console.log(`operator     : ${txn.operator}`);
  console.log(`amount/fee   : ${txn.amount} / ${txn.fee}`);
  console.log(`created/upd  : ${txn.createdAt.toISOString()} / ${txn.updatedAt.toISOString()}`);
  console.log(`\n--- request JSON (PII masked) ---`);
  console.log(JSON.stringify(maskObj(txn.request), null, 2));
  console.log(`\n--- response JSON ---`);
  console.log(JSON.stringify(maskObj(txn.response), null, 2));

  // PartnerApiLog — the durable money-call log for this ref.
  const logs = await prisma.partnerApiLog.findMany({
    where: { txnRefId: txn.refId },
    orderBy: { createdAt: "asc" },
    select: {
      createdAt: true, provider: true, method: true, path: true,
      httpStatus: true, ok: true, code: true, providerRef: true,
      request: true, response: true,
    },
  });
  console.log(`\n--- PartnerApiLog entries: ${logs.length} ---`);
  for (const l of logs) {
    console.log(
      `  [${l.createdAt.toISOString()}] ${l.method} ${l.path}  http=${l.httpStatus ?? "-"}  ok=${l.ok}  code=${l.code ?? "-"}  providerRef=${l.providerRef ?? "(none)"}`
    );
    console.log(`     request : ${JSON.stringify(maskObj(l.request))}`);
    console.log(`     response: ${JSON.stringify(maskObj(l.response))}`);
  }

  // Derive every candidate poll reference.
  const inRow = deriveTxnRefs({ partnerTxnId: txn.partnerTxnId, request: txn.request, response: txn.response });
  const fromLog = await recoverRefsFromApiLog(txn.refId);
  const allRefs = Array.from(new Set([...inRow, ...fromLog]));
  console.log(`\n--- Derived poll references ---`);
  console.log(`  from row (deriveTxnRefs)      : ${JSON.stringify(inRow)}`);
  console.log(`  from PartnerApiLog (recover)  : ${JSON.stringify(fromLog)}`);
  console.log(`  union                         : ${JSON.stringify(allRefs)}`);

  if (allRefs.length === 0) {
    console.log(`\n  No poll references at all — the payment cannot be queried by any stored id.`);
    await prisma.$disconnect();
    return;
  }

  // Poll the provider status() for each ref, print the RAW result.
  console.log(`\n--- Provider status() per reference (read-only) ---`);
  if (txn.partner === RK_PARTNER) {
    const { rechargekitStatus } = await import("../src/lib/partners/sameday-rechargekit");
    for (const ref of allRefs) {
      const byTxn = await rechargekitStatus({ txnId: ref });
      console.log(`  ref=${ref}  as txnId  -> ${JSON.stringify(byTxn)}`);
      const byReq = await rechargekitStatus({ requestId: ref });
      console.log(`  ref=${ref}  as reqId  -> ${JSON.stringify(byReq)}`);
    }
  } else {
    const { getPartner } = await import("../src/lib/partners");
    const bbps = getPartner("bbps");
    if (!bbps.status) { console.log("  bbps provider has no status() method"); }
    else {
      for (const ref of allRefs) {
        const byOrder = await bbps.status({ orderId: ref });
        console.log(`  ref=${ref}  as orderId -> ${JSON.stringify(byOrder)}`);
        const byReq = await bbps.status({ requestId: ref });
        console.log(`  ref=${ref}  as reqId   -> ${JSON.stringify(byReq)}`);
      }
    }
  }

  console.log(`\n=== end ===\n`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
