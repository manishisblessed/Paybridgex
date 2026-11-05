/**
 * READ-ONLY. Mutates NOTHING (no DB writes, no provider calls).
 *
 * Full per-transaction detail sheet for every NEEDS_REVIEW BBPS/Pay2New row:
 * retailer, biller (operator / product_code), card last-4, registered mobile,
 * amount + fee, exact timing (UTC + IST), and every provider reference we hold
 * (partnerTxnId, bill_fetch_ref, request_id SDS…). Intended for reconciling /
 * verifying each payment with Same Day by Request ID.
 *
 * Run on the server:
 *   cd ~/paybridgex && set -a && source ~/env-paybridgex && set +a \
 *     && ./node_modules/.bin/tsx scripts/diag-needs-review-biller-details.ts
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    const p = resolve(process.cwd(), f);
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
loadEnv();

const inr = (n: unknown) =>
  "₹" + Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Format a Date as IST (UTC+5:30) "YYYY-MM-DD HH:MM:SS IST". */
function ist(d: Date): string {
  const t = new Date(d.getTime() + 5.5 * 3_600_000);
  return t.toISOString().replace("T", " ").slice(0, 19) + " IST";
}

/** Pull a string field from a loosely-keyed JSON bag (top-level + one level of `data`). */
function pick(obj: unknown, keys: string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  const r = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  const data = r.data;
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    for (const k of keys) {
      const v = d[k];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (typeof v === "number") return String(v);
    }
  }
  return null;
}

/** Mine bill_fetch_ref and request_id (SDS…) from request + response. */
function mineRefs(...blobs: unknown[]) {
  const out = { billFetchRef: null as string | null, requestId: null as string | null, orderId: null as string | null };
  const scan = (o: unknown) => {
    if (!o || typeof o !== "object") return;
    const r = o as Record<string, unknown>;
    out.billFetchRef ??= (typeof r.bill_fetch_ref === "string" && r.bill_fetch_ref) || null;
    out.requestId ??= (typeof r.request_id === "string" && r.request_id) || null;
    out.orderId ??= (typeof r.order_id === "string" && r.order_id) || null;
    for (const v of Object.values(r)) if (v && typeof v === "object") scan(v);
  };
  for (const b of blobs) scan(b);
  return out;
}

async function main() {
  const { prisma } = await import("../src/lib/db");

  const rows = await prisma.transaction.findMany({
    where: { status: "NEEDS_REVIEW", service: "BILL_CREDIT_CARD", partner: "SAMEDAY_PAY2NEW" },
    orderBy: { createdAt: "asc" },
    select: {
      refId: true, amount: true, fee: true, gst: true, status: true, errorCode: true,
      customer: true, operator: true, partner: true, partnerTxnId: true,
      request: true, response: true, createdAt: true,
      user: { select: { name: true, userCode: true, phone: true } },
    },
  });

  console.log(`\n=== NEEDS_REVIEW BBPS/Pay2New — full biller + reference sheet (READ-ONLY) ===`);
  console.log(`Rows: ${rows.length}\n`);

  // Detailed blocks
  for (const t of rows) {
    const refs = mineRefs(t.request, t.response);
    const productCode = pick(t.request, ["product_code"]);
    const productName = pick(t.request, ["product_name"]);
    const cardLast4 = pick(t.request, ["number"]) ?? t.customer;
    const mobile = pick(t.request, ["customer_number", "optional1", "mobile"]);
    const reqAmount = pick(t.request, ["amount"]);
    console.log(`──────────────────────────────────────────────────────────────`);
    console.log(`refId        : ${t.refId}`);
    console.log(`retailer     : ${t.user?.name ?? "?"} (${t.user?.userCode ?? "?"})  mobile=${t.user?.phone ?? "—"}`);
    console.log(`biller       : operator=${t.operator ?? "—"}  product_code=${productCode ?? "—"}  product_name=${productName ?? "—"}`);
    console.log(`card last-4  : ${cardLast4 ?? "—"}   customer_mobile=${mobile ?? "—"}`);
    console.log(`amount       : ${inr(t.amount)}  fee=${inr(t.fee)}  reserve=${inr(Number(t.amount) + Number(t.fee))}  (pay amount sent=${reqAmount ?? "—"})`);
    console.log(`status       : ${t.status}   errorCode=${t.errorCode ?? "—"}`);
    console.log(`created      : ${t.createdAt.toISOString()}  |  ${ist(t.createdAt)}`);
    console.log(`partnerTxnId : ${t.partnerTxnId ?? "(blank — pay response lost)"}`);
    console.log(`request_id   : ${refs.requestId ?? "—"}`);
    console.log(`bill_fetch_ref: ${refs.billFetchRef ?? "—"}`);
    console.log(`order_id     : ${refs.orderId ?? "(null)"}`);
    console.log("");
  }

  // Compact TSV table for pasting into the Sameday email / a sheet
  console.log(`\n=== TSV (copy into a sheet) ===`);
  console.log(
    ["refId","retailer","retailerCode","biller","product_code","cardLast4","mobile","amount","fee","created_IST","request_id","bill_fetch_ref","errorCode"].join("\t")
  );
  for (const t of rows) {
    const refs = mineRefs(t.request, t.response);
    const productCode = pick(t.request, ["product_code"]) ?? "";
    const cardLast4 = pick(t.request, ["number"]) ?? t.customer ?? "";
    const mobile = pick(t.request, ["customer_number", "optional1", "mobile"]) ?? "";
    console.log(
      [
        t.refId,
        t.user?.name ?? "",
        t.user?.userCode ?? "",
        t.operator ?? "",
        productCode,
        cardLast4,
        mobile,
        Number(t.amount),
        Number(t.fee),
        ist(t.createdAt),
        refs.requestId ?? "",
        refs.billFetchRef ?? "",
        t.errorCode ?? "",
      ].join("\t")
    );
  }

  await prisma.$disconnect();
  console.log(`\n=== end (no changes were made) ===\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
