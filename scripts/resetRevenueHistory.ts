/**
 * FINANCIAL / REVENUE HISTORY RESET (pre-go-live clean slate).
 *
 * Wipes ALL money-movement & ledger history so the Company Earnings & Revenue
 * Wallet report — and the Payin monitor — start from ₹0 and are recomputed from
 * real transactions going forward. Zeros every user's wallet balances.
 *
 * PRESERVES (unlike scripts/reset-production.ts):
 *   • AuditLog / AuditAnchor  (compliance trail)
 *   • Invite / Notification    (onboarding + comms history)
 *   • Session / LoginAttempt / Otp / Dispute / RateLimit
 *   • All users, KYC, schemes, MDR & commission config, POS machines, StaticQr,
 *     PayoutBeneficiary, AepsMerchant, per-user limits & settlement config.
 *
 * WIPES (financial/ledger history only):
 *   Transaction, WalletTxn, CommissionCredit, TdsLedgerEntry, PosSettlementEntry,
 *   PgSettlementEntry, PosTransactionMirror, QrClaim, AepsSettlement,
 *   PayoutRequest, NetworkWalletTransfer, HierarchyTransfer, Reversal,
 *   WalletLien, WalletOperation, FundRequest, SettlementRun, SettlementAlert,
 *   PosRentalInvoice, IdempotencyKey
 *
 * ZEROS on User: walletBalance, heldBalance, lienBalance, aepsBalance,
 *                revenueBalance, payinBalance.
 *
 * SAFETY:
 *   • Dry-run by default. Pass --apply to write.
 *   • Pre-flight FK-closure check: aborts if TRUNCATE ... CASCADE would reach a
 *     PRESERVED table that still holds rows (so nothing you want to keep is lost).
 *
 *   npx tsx scripts/resetRevenueHistory.ts            # dry-run
 *   npx tsx scripts/resetRevenueHistory.ts --apply    # execute
 */
import fs from "node:fs";
import path from "node:path";

function loadEnv(file: string) {
  const p = path.resolve(process.cwd(), file);
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv(".env");
loadEnv(".env.local");

const APPLY = process.argv.includes("--apply");

const WIPE_TABLES = [
  "Transaction",
  "WalletTxn",
  "CommissionCredit",
  "TdsLedgerEntry",
  "PosSettlementEntry",
  "PgSettlementEntry",
  "PosTransactionMirror",
  "QrClaim",
  "AepsSettlement",
  "PayoutRequest",
  "NetworkWalletTransfer",
  "HierarchyTransfer",
  "Reversal",
  "WalletLien",
  "WalletOperation",
  "FundRequest",
  "SettlementRun",
  "SettlementAlert",
  "PosRentalInvoice",
  "IdempotencyKey",
] as const;

async function main() {
  const { prisma } = await import("../src/lib/db");
  const wipeSet = new Set<string>(WIPE_TABLES);

  console.log(`\n=== FINANCIAL / REVENUE HISTORY RESET — mode: ${APPLY ? "APPLY (WRITING)" : "DRY-RUN"} ===\n`);

  // ── Before counts ──
  console.log("Rows to be deleted:");
  let totalToDelete = 0;
  for (const t of WIPE_TABLES) {
    const rows = await prisma.$queryRawUnsafe<{ c: bigint }[]>(`SELECT COUNT(*)::bigint AS c FROM "${t}"`);
    const n = Number(rows[0]?.c ?? 0);
    totalToDelete += n;
    if (n > 0) console.log(`  ${t.padEnd(24)} ${n}`);
  }
  console.log(`  TOTAL: ${totalToDelete}`);

  const balBefore = await prisma.$queryRawUnsafe<any[]>(`
    SELECT COALESCE(SUM("walletBalance"),0)::float8 AS wallet,
           COALESCE(SUM("revenueBalance"),0)::float8 AS revenue,
           COALESCE(SUM("payinBalance"),0)::float8 AS payin
    FROM "User"`);
  console.log(
    `\nBalances now: Σwallet=₹${balBefore[0].wallet}  Σrevenue=₹${balBefore[0].revenue}  Σpayin=₹${balBefore[0].payin}`
  );

  // ── Pre-flight FK-closure safety check ──
  // Find FKs where a PRESERVED table references a WIPED table: TRUNCATE ... CASCADE
  // would also truncate that preserved table. Abort if it holds rows.
  const fks = await prisma.$queryRawUnsafe<{ child: string; parent: string }[]>(`
    SELECT tc.table_name AS child, ccu.table_name AS parent
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
  `);
  const conflicts: { child: string; parent: string; rows: number }[] = [];
  const cascadeEmpties: { child: string; parent: string }[] = [];
  for (const fk of fks) {
    if (wipeSet.has(fk.parent) && !wipeSet.has(fk.child) && fk.child !== fk.parent) {
      const rows = await prisma.$queryRawUnsafe<{ c: bigint }[]>(`SELECT COUNT(*)::bigint AS c FROM "${fk.child}"`);
      const n = Number(rows[0]?.c ?? 0);
      if (n > 0) conflicts.push({ child: fk.child, parent: fk.parent, rows: n });
      else cascadeEmpties.push({ child: fk.child, parent: fk.parent });
    }
  }

  if (cascadeEmpties.length) {
    console.log("\nPreserved tables that CASCADE would also truncate (all EMPTY — harmless):");
    for (const c of Array.from(new Set(cascadeEmpties.map((c) => `${c.child} → ${c.parent}`)))) console.log(`  ${c}`);
  }
  if (conflicts.length) {
    console.log("\n✗ ABORT — CASCADE would truncate PRESERVED tables that hold data:");
    for (const c of conflicts) console.log(`  ${c.child} (${c.rows} rows) → references ${c.parent}`);
    console.log("\nResolve by adding these tables to WIPE_TABLES or handling them explicitly. No changes made.\n");
    await prisma.$disconnect();
    return;
  }
  console.log("\n✓ FK pre-flight OK — CASCADE stays within the financial wipe set.");

  if (!APPLY) {
    console.log("\nDRY-RUN — nothing written. Re-run with --apply to execute.\n");
    await prisma.$disconnect();
    return;
  }

  // ── Execute: truncate financial tables + zero all balances, atomically ──
  console.log("\nExecuting reset…");
  const tableList = WIPE_TABLES.map((t) => `"${t}"`).join(", ");
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
    await tx.$executeRawUnsafe(`
      UPDATE "User" SET
        "walletBalance"  = 0,
        "heldBalance"    = 0,
        "lienBalance"    = 0,
        "aepsBalance"    = 0,
        "revenueBalance" = 0,
        "payinBalance"   = 0`);
  });
  console.log("  ✓ Financial tables truncated. ✓ All user balances zeroed (incl. payinBalance).");

  // ── Verify ──
  console.log("\nVerifying…");
  let remaining = 0;
  for (const t of WIPE_TABLES) {
    const rows = await prisma.$queryRawUnsafe<{ c: bigint }[]>(`SELECT COUNT(*)::bigint AS c FROM "${t}"`);
    remaining += Number(rows[0]?.c ?? 0);
  }
  const balAfter = await prisma.$queryRawUnsafe<any[]>(`
    SELECT COALESCE(SUM("walletBalance" + "heldBalance" + "lienBalance" + "aepsBalance" + "revenueBalance" + "payinBalance"),0)::float8 AS s
    FROM "User"`);
  const preserved = await prisma.$queryRawUnsafe<any[]>(`
    SELECT
      (SELECT COUNT(*)::int FROM "AuditLog")     AS audit,
      (SELECT COUNT(*)::int FROM "Invite")        AS invite,
      (SELECT COUNT(*)::int FROM "Notification")  AS notif,
      (SELECT COUNT(*)::int FROM "User")          AS users`);

  console.log(`  financial rows remaining : ${remaining} (expected 0)`);
  console.log(`  Σ all balances           : ₹${balAfter[0].s} (expected 0)`);
  console.log(`  PRESERVED → AuditLog=${preserved[0].audit}  Invite=${preserved[0].invite}  Notification=${preserved[0].notif}  Users=${preserved[0].users}`);

  const ok = remaining === 0 && Number(balAfter[0].s) === 0;
  console.log(
    ok
      ? "\n✓ Revenue history cleared. The report will read ₹0 and rebuild from real transactions.\n"
      : "\n⚠ Verification numbers look off — review above.\n"
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("\n✗ Reset FAILED:", e);
  process.exit(1);
});
