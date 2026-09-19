/**
 * Reconciliation verification + operator CLI.
 *
 * The one thing that can't be verified without the live/sandbox provider is the
 * end-to-end PENDING → terminal flow. This script gives ops a safe, auditable
 * way to do exactly that against the REAL provider status API, and to drain a
 * backlog from the box (IP-whitelisted) without the dashboard.
 *
 * Every action RE-POLLS the provider and finalizes through the shared idempotent
 * `finalizeServiceTransaction`, so it NEVER blind-refunds a possibly-charged
    10| * card and racing with the webhook/sweep is a safe no-op.
 *
 * Usage:
 *   npm run recon:verify                 # list stuck PROCESSING RK + BBPS rows
 *   npm run recon:verify -- --list       # (same as default)
 *   npm run recon:verify -- <refId>      # reconcile ONE txn (refId or partnerTxnId)
 *   npm run recon:verify -- --sweep-rk   # run the RechargeKit sweep once
 *   npm run recon:verify -- --sweep-bbps # run the BBPS sweep once
 *
 * Recommended go-live check:
    20| *   1. Make one real RechargeKit CC-2 payment that returns PENDING.
 *   2. `npm run recon:verify -- <refId>` → expect settled/refunded/pending.
 *   3. Repeat for a BBPS bill payment and confirm the Revenue Wallet margin.
 */

export {};

try {
  (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.();
} catch {
    30|  /* env provided by the shell */
}

const RK_PARTNER = "SAMEDAY_RECHARGEKIT";
const BBPS_SERVICES = [
  "BILL_ELECTRICITY",
  "BILL_WATER",
  "BILL_GAS",
  "BILL_CREDIT_CARD",
  "BILL_EDUCATION",
  "BILL_INSURANCE",
    40|  "RECHARGE_BROADBAND",
] as const;

function ageString(from: Date): string {
  const ms = Date.now() - from.getTime();
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
    50|}

async function listStuck() {
  const { prisma } = await import("@/lib/db");
  const rows = await prisma.transaction.findMany({
    where: {
      status: "PROCESSING",
      OR: [
        { partner: RK_PARTNER },
        { service: { in: BBPS_SERVICES as unknown as string[] }, partner: { not: RK_PARTNER } },
      ],
    60|    },
    orderBy: { createdAt: "asc" },
    take: 500,
    select: {
      refId: true,
      partner: true,
      service: true,
      amount: true,
      partnerTxnId: true,
      createdAt: true,
    },
    70|  });

  if (rows.length === 0) {
    console.log("[recon:verify] No PROCESSING RechargeKit/BBPS transactions. All clear.");
    return;
  }

  console.log(`[recon:verify] ${rows.length} stuck PROCESSING row(s):\n`);
  console.log(
    ["REF_ID".padEnd(16), "RAIL".padEnd(20), "SERVICE".padEnd(18), "AMOUNT".padStart(12), "AGE".padStart(8), "PARTNER_REF"].join(
      "  "
    80|    )
  );
  for (const r of rows) {
    const rail = r.partner === RK_PARTNER ? "rechargekit" : "bbps";
    console.log(
      [
        String(r.refId).padEnd(16),
        String(rail).padEnd(20),
        String(r.service).padEnd(18),
        `₹${Number(r.amount).toFixed(2)}`.padStart(12),
    90|        ageString(r.createdAt).padStart(8),
        r.partnerTxnId ? String(r.partnerTxnId) : "(none — response fallback)",
      ].join("  ")
    );
  }
  console.log(
    `\nReconcile one:  npm run recon:verify -- <refId>\n` +
      `Drain all:      npm run recon:verify -- --sweep-rk   (and --sweep-bbps)`
  );
}

   100|async function reconcileOne(ref: string) {
  const { reconcileOneTransaction } = await import("@/lib/recon/reconcileOne");
  console.log(`[recon:verify] reconciling "${ref}" (re-polling the provider)…`);
  const r = await reconcileOneTransaction(ref, { source: "cli_verify" });
  console.log("[recon:verify] result:", JSON.stringify(r, null, 2));
  if (!r.found) {
    console.warn("[recon:verify] No transaction matched that reference.");
    process.exit(2);
  }
}

   110|async function sweepRk() {
  const { runRechargekitReconciliation } = await import("@/lib/recon/rechargekit");
  console.log("[recon:verify] running RechargeKit sweep…");
  const r = await runRechargekitReconciliation();
  console.log("[recon:verify] rechargekit:", JSON.stringify(r, null, 2));
}

async function sweepBbps() {
  const { runBbpsReconciliation } = await import("@/lib/recon/bbps");
  console.log("[recon:verify] running BBPS sweep…");
   120|  const r = await runBbpsReconciliation();
  console.log("[recon:verify] bbps:", JSON.stringify(r, null, 2));
}

async function main() {
  const arg = process.argv[2];

  if (!arg || arg === "--list") {
    await listStuck();
  } else if (arg === "--sweep-rk") {
    await sweepRk();
   130|  } else if (arg === "--sweep-bbps") {
    await sweepBbps();
  } else if (arg.startsWith("--")) {
    console.error(`[recon:verify] Unknown flag "${arg}". See the header for usage.`);
    process.exit(1);
  } else {
    await reconcileOne(arg);
  }

  process.exit(0);
}

   140|main().catch((e) => {
  console.error("[recon:verify] failed:", e);
  process.exit(1);
});
