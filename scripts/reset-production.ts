/**
 * PRODUCTION GO-LIVE RESET (one-shot, re-runnable).
 *
 * Purpose: wipe all TEST transactional/operational data so the platform can
 * start clean for real money movement, while PRESERVING:
 *   • all User accounts (identity, login, 2FA, PIN, hierarchy, roles)
 *   • user KYC / onboarding / identity records
 *   • all platform configuration & master data (schemes, MDR, commissions,
 *     operators, billers, service routes, rental plans, brands, settings,
 *     POS inventory, per-user limits & settlement config, whitelabel, API keys)
 *
 * It also RESETS every user's wallet balances to 0 for a clean opening ledger.
 *
 * Safety:
 *   • Requires env CONFIRM_RESET=RESET_PRODUCTION to run (guards accidental runs).
 *   • The wiped-table set is closed under foreign keys and NO retained table
 *     references any wiped table, so `TRUNCATE ... CASCADE` cannot delete kept data.
 *   • Prints before/after counts.
 *
 * Run (PowerShell, from repo root):
 *   $env:CONFIRM_RESET="RESET_PRODUCTION"; npx tsx scripts/reset-production.ts
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// tsx does not auto-load .env — hydrate DATABASE_URL/DIRECT_URL from disk so the
// Prisma client (lazy, built on first access) can connect to production.
function loadEnvFile(): void {
  for (const file of [".env.local", ".env"]) {
    const p = resolve(process.cwd(), file);
    if (!existsSync(p)) continue;
    for (const raw of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2];
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  }
}
loadEnvFile();

// Transactional / operational tables to wipe (test data). This set is closed
// under FKs; CASCADE handles the internal ordering. Order here is irrelevant.
const WIPE_TABLES = [
  "HierarchyTransfer",
  "NetworkWalletTransfer",
  "PosSettlementEntry",
  "TdsLedgerEntry",
  "CommissionCredit",
  "QrClaim",
  "AepsSettlement",
  "AepsSettlementAccount",
  "AepsMerchant",
  "PosRentalInvoice",
  "PosSubscription",
  "SettlementAlert",
  "SettlementRun",
  "Reversal",
  "WalletLien",
  "WalletOperation",
  "StaticQr",
  "PosAssignmentLog",
  "PayoutBeneficiary",
  "PayoutRequest",
  "RateLimit",
  "IdempotencyKey",
  "Invite",
  "DisputeMessage",
  "Dispute",
  "Notification",
  "AuditLog",
  "AuditAnchor",
  "AmlAlert",
  "WebhookDelivery",
  "FundRequest",
  "Transaction",
  "WalletTxn",
  "Otp",
  "LoginAttempt",
  "Session",
] as const;

async function main() {
  if (process.env.CONFIRM_RESET !== "RESET_PRODUCTION") {
    console.error(
      "\n✗ Refusing to run. This DELETES all transactional data.\n" +
        '  Re-run with:  $env:CONFIRM_RESET="RESET_PRODUCTION"; npx tsx scripts/reset-production.ts\n'
    );
    process.exit(1);
  }

  const { prisma } = await import("../src/lib/db");

  console.log("→ Connecting to production database…");
  const userCountBefore = await prisma.user.count();
  console.log(`  Users on record (preserved): ${userCountBefore}`);

  console.log("\n→ Rows to be deleted:");
  let totalToDelete = 0;
  for (const t of WIPE_TABLES) {
    const rows = await prisma.$queryRawUnsafe<{ c: bigint }[]>(
      `SELECT COUNT(*)::bigint AS c FROM "${t}"`
    );
    const n = Number(rows[0]?.c ?? 0);
    totalToDelete += n;
    if (n > 0) console.log(`    ${t.padEnd(24)} ${n}`);
  }
  console.log(`  Total rows to delete: ${totalToDelete}`);

  console.log("\n→ Executing reset (truncate + zero balances) in a transaction…");
  const tableList = WIPE_TABLES.map((t) => `"${t}"`).join(", ");

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`
    );
    await tx.$executeRawUnsafe(
      `UPDATE "User" SET
         "walletBalance" = 0,
         "heldBalance"   = 0,
         "lienBalance"   = 0,
         "aepsBalance"   = 0,
         "revenueBalance"= 0`
    );
  });

  console.log("  ✓ Truncate complete. ✓ All user wallet balances reset to 0.");

  console.log("\n→ Verifying:");
  let remaining = 0;
  for (const t of WIPE_TABLES) {
    const rows = await prisma.$queryRawUnsafe<{ c: bigint }[]>(
      `SELECT COUNT(*)::bigint AS c FROM "${t}"`
    );
    remaining += Number(rows[0]?.c ?? 0);
  }
  const userCountAfter = await prisma.user.count();
  const bal = await prisma.$queryRawUnsafe<{ s: number | null }[]>(
    `SELECT COALESCE(SUM("walletBalance" + "heldBalance" + "lienBalance" + "aepsBalance" + "revenueBalance"),0)::float8 AS s FROM "User"`
  );

  console.log(`    Transactional rows remaining: ${remaining} (expected 0)`);
  console.log(`    Users preserved:              ${userCountAfter} (was ${userCountBefore})`);
  console.log(`    Sum of all wallet balances:   ${bal[0]?.s ?? 0} (expected 0)`);

  if (remaining === 0 && userCountAfter === userCountBefore) {
    console.log("\n✓ Production reset complete. Ready for real data & transactions.");
  } else {
    console.log("\n⚠ Reset finished but verification numbers look off — review above.");
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("\n✗ Reset FAILED:", e);
  process.exit(1);
});
