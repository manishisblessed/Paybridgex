/**
 * READ-ONLY diagnostic. Mutates NOTHING (no DB writes, no money movement).
 *
 * For every NEEDS_REVIEW BBPS/Pay2New transaction, poll Same Day's bill/status
 * API across all candidate references and print the RAW provider response — in
 * particular the raw `status` string and `amount` — alongside how our adapter
 * maps it. This reveals whether a row that shows "PENDING" in the panel is:
 *   (a) genuinely PENDING at the provider, or
 *   (b) a terminal state (REFUNDED / FAILED / a value our mapper doesn't know)
 *       that is being collapsed to PENDING by mapPay2NewStatus().
 *
 * MUST run on the IP-whitelisted host (EC2):
 *   cd ~/paybridgex && set -a && source ~/env-paybridgex && set +a \
 *     && ./node_modules/.bin/tsx scripts/diag-needs-review-raw-status.ts
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

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { flags } = await import("../src/lib/env");
  const { deriveTxnRefs } = await import("../src/lib/recon/refs");
  const { samedayCredentials, samedayRequest } = await import("../src/lib/partners/sameday-core");

  console.log(`\n=== RAW Same Day status for NEEDS_REVIEW BBPS rows (READ-ONLY) ===`);
  console.log(`bbps flag: ${flags.bbps ? "on" : "off"}`);

  const creds = samedayCredentials("BBPS");
  if (!creds) {
    console.log("✗ Same Day BBPS credentials not configured in this env. Aborting.");
    await prisma.$disconnect();
    return;
  }
  console.log(`baseUrl  : ${creds.baseUrl}`);

  const rows = await prisma.transaction.findMany({
    where: { status: "NEEDS_REVIEW", service: "BILL_CREDIT_CARD", partner: "SAMEDAY_PAY2NEW" },
    orderBy: { createdAt: "asc" },
    select: {
      refId: true, amount: true, fee: true, errorCode: true, partnerTxnId: true,
      request: true, response: true, createdAt: true,
      user: { select: { name: true, userCode: true } },
    },
  });

  console.log(`Rows     : ${rows.length}\n`);

  const P = "/api/partner/pay2new";

  for (const t of rows) {
    const reserve = Number(t.amount) + Number(t.fee);
    console.log(`──────────────────────────────────────────────────────────────`);
    console.log(`${t.refId}  ${t.user?.name ?? "?"} (${t.user?.userCode ?? "?"})`);
    console.log(`  amount=${inr(t.amount)} fee=${inr(t.fee)} reserve=${inr(reserve)}  errorCode=${t.errorCode ?? "—"}`);
    console.log(`  partnerTxnId=${t.partnerTxnId ?? "(blank)"}  created=${t.createdAt.toISOString()}`);

    const refs = deriveTxnRefs({ partnerTxnId: t.partnerTxnId, request: t.request, response: t.response });
    console.log(`  poll refs (${refs.length}): ${refs.length ? refs.join(", ") : "(NONE — unpollable)"}`);

    for (const ref of refs) {
      // Try each key form the provider accepts: order_id → request_id → bill_fetch_ref.
      for (const key of ["order_id", "request_id", "bill_fetch_ref"] as const) {
        const r = await samedayRequest<Record<string, unknown>>(creds, "POST", `${P}/bill/status`, { [key]: ref });
        if (!r.ok) {
          console.log(`    [${key}=${ref}] -> poll FAILED code=${r.code} ${r.message ?? ""}`);
          continue;
        }
        const raw = r.data as Record<string, unknown>;
        console.log(`    [${key}=${ref}] -> RAW status="${raw.status ?? "?"}" amount=${raw.amount ?? "?"} opRef=${raw.operator_reference ?? "—"} order_id=${raw.order_id ?? "—"} request_id=${raw.request_id ?? "—"}`);
        console.log(`        full: ${JSON.stringify(raw)}`);
        break; // got an authoritative answer for this ref; move to next ref
      }
    }
    console.log("");
  }

  await prisma.$disconnect();
  console.log(`=== end (no changes were made) ===\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
