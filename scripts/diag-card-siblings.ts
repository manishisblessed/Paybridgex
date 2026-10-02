/**
 * READ-ONLY correlation inspector — "who else was charged on this card?"
 *
 * Built for the TXN7H58YLAMOT class of incident, where a lost pay response made
 * us mark a payment FAILED + auto-refund, the retailer RETRIED, and the
 * customer's card may have been charged MORE THAN ONCE. Before correcting the
 * original row (promote → SUCCESS + lien clawback) we must be certain WHICH
 * SameDay pay-order actually belongs to it, and whether there are duplicate
 * charges that instead need a provider-side refund.
 *
 * What it prints (no writes, no money movement — only status() reads):
 *   • the TARGET txn (status, amount/fee, partnerTxnId, stored bill_fetch_ref)
 *   • every SIBLING credit-card bill payment by the same retailer in a time
 *     window (default ±3 days), matched on card last-4 / mobile, with each
 *     row's status, amount/fee, derived provider order ids, and whether a
 *     refund (reversal walletTxn) was already booked
 *   • optional: for any OrderIDs you pass in ORDERS=a,b,c it polls SameDay
 *     bill/status and prints the authoritative status + amount + charge +
 *     operator_reference, so you can confirm a pasted P2F… id is a real,
 *     distinct SUCCESS before using it as PROVIDER_REF.
 *
 * Usage (on the IP-whitelisted EC2 box):
 *   REF=TXN7H58YLAMOT ./node_modules/.bin/tsx scripts/diag-card-siblings.ts
 *   REF=TXN7H58YLAMOT ORDERS=P2F1790849703RPX6S,P2F1790849653R7GDU ./node_modules/.bin/tsx scripts/diag-card-siblings.ts
 *
 * Optional:
 *   WINDOW_DAYS=3   half-width of the sibling search window around the target
 */
import "./_load-env";
import { prisma } from "../src/lib/db";
import { deriveTxnRefs } from "../src/lib/recon/refs";
import { getPartner } from "../src/lib/partners";

const REF = (process.env.REF ?? "").trim();
const ORDERS = (process.env.ORDERS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const WINDOW_DAYS = Number(process.env.WINDOW_DAYS ?? 3);

/** Pull the first 10-digit mobile and any card last-4 out of a payload blob. */
function identifiers(blob: unknown): { mobiles: string[]; last4s: string[] } {
  const s = JSON.stringify(blob ?? "");
  const mobiles = Array.from(new Set((s.match(/\b[6-9]\d{9}\b/g) ?? [])));
  // "****8007", "XXXX8007", "...8007" → capture a trailing 4-digit group after mask chars.
  const last4s = Array.from(
    new Set((s.match(/(?:[*xX]{2,}|\b)(\d{4})\b/g) ?? []).map((m) => m.slice(-4)))
  );
  return { mobiles, last4s };
}

// True if ANY refund was returned for this txn — detected by the durable ledger
// link (REVERSAL credit → this Transaction), so it also catches refunds written
// by older code under non-standard idempotency keys.
async function hasReversal(userId: string, txnInternalId: string): Promise<boolean> {
  const r = await prisma.walletTxn.findFirst({
    where: {
      userId,
      direction: "CREDIT",
      reason: "REVERSAL",
      refType: "Transaction",
      refId: txnInternalId,
    },
    select: { id: true },
  });
  return !!r;
}

async function main() {
  if (!REF) {
    console.error("Set REF=TXN...  e.g.  REF=TXN7H58YLAMOT ./node_modules/.bin/tsx scripts/diag-card-siblings.ts");
    process.exit(1);
  }

  const target = await prisma.transaction.findFirst({
    where: { OR: [{ refId: REF }, { partnerTxnId: REF }] },
    select: {
      id: true, refId: true, userId: true, service: true, partner: true, status: true,
      amount: true, fee: true, partnerTxnId: true, request: true, response: true,
      createdAt: true,
    },
  });
  if (!target) { console.error(`No transaction found for ${REF}`); process.exit(1); }

  const tgtIds = identifiers(target.request);
  const tgtRefs = deriveTxnRefs({ partnerTxnId: target.partnerTxnId, request: target.request, response: target.response });

  console.log(`\n=== TARGET ${target.refId} ===`);
  console.log(`user         : ${target.userId}`);
  console.log(`service/part : ${target.service} / ${target.partner}`);
  console.log(`status       : ${target.status}`);
  console.log(`amount/fee   : ${target.amount} / ${target.fee}  (total ${Number(target.amount) + Number(target.fee)})`);
  console.log(`partnerTxnId : ${target.partnerTxnId ?? "(blank)"}`);
  console.log(`created      : ${target.createdAt.toISOString()}`);
  console.log(`derived refs : ${JSON.stringify(tgtRefs)}`);
  console.log(`identifiers  : mobiles=${JSON.stringify(tgtIds.mobiles)} last4=${JSON.stringify(tgtIds.last4s)}`);
  console.log(`refunded?    : ${(await hasReversal(target.userId, target.id)) ? "YES (reversal booked)" : "no"}`);

  // Siblings: same retailer, same service, within the window — then match on
  // card last-4 / mobile so we only surface the SAME card's payments.
  const from = new Date(target.createdAt.getTime() - WINDOW_DAYS * 86_400_000);
  const to = new Date(target.createdAt.getTime() + WINDOW_DAYS * 86_400_000);
  const candidates = await prisma.transaction.findMany({
    where: {
      userId: target.userId,
      service: target.service,
      createdAt: { gte: from, lte: to },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, refId: true, status: true, amount: true, fee: true, partnerTxnId: true,
      request: true, response: true, createdAt: true, userId: true,
    },
  });

  console.log(`\n=== SIBLINGS on the same card (${WINDOW_DAYS}d window) ===`);
  let shown = 0;
  for (const c of candidates) {
    const ids = identifiers(c.request);
    const sameMobile = ids.mobiles.some((m) => tgtIds.mobiles.includes(m));
    const sameCard = ids.last4s.some((l) => tgtIds.last4s.includes(l));
    if (!sameMobile && !sameCard && c.refId !== target.refId) continue;
    shown++;
    const refs = deriveTxnRefs({ partnerTxnId: c.partnerTxnId, request: c.request, response: c.response });
    const refunded = await hasReversal(c.userId, c.id);
    const flag = c.refId === target.refId ? "  <-- TARGET" : "";
    console.log(
      `\n  [${c.createdAt.toISOString()}] ${c.refId}${flag}\n` +
        `     status=${c.status}  amount/fee=${c.amount}/${c.fee}  refunded=${refunded ? "YES" : "no"}\n` +
        `     partnerTxnId=${c.partnerTxnId ?? "(blank)"}\n` +
        `     derived refs=${JSON.stringify(refs)}\n` +
        `     match: mobile=${sameMobile} card=${sameCard}`
    );
  }
  if (shown === 0) console.log("  (none matched — widen WINDOW_DAYS or check identifiers above)");

  // Optional: confirm pasted OrderIDs against SameDay's authoritative status.
  if (ORDERS.length) {
    console.log(`\n=== Provider bill/status for pasted OrderIDs (read-only) ===`);
    const bbps = getPartner("bbps");
    if (!bbps.status) {
      console.log("  bbps provider has no status() method");
    } else {
      for (const id of ORDERS) {
        let r = await bbps.status({ orderId: id });
        if (!r.ok) r = await bbps.status({ requestId: id });
        if (!r.ok) {
          console.log(`  ${id} -> NOT RESOLVED (${r.code})`);
          continue;
        }
        const raw = (r.raw ?? {}) as Record<string, unknown>;
        console.log(
          `  ${id} -> status=${r.data.status}  amount=${raw.amount ?? "-"}  charge=${raw.charge ?? "-"}  ` +
            `operator_reference=${r.data.operatorRef ?? "-"}  payRef=${r.data.orderId ?? r.data.requestId ?? "-"}`
        );
      }
    }
  }

  console.log(`\n=== end ===\n`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
