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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv(".env");
loadEnv(".env.local");

async function main() {
  const { prisma } = await import("../src/lib/db");
  const q = (sql: string) => prisma.$queryRawUnsafe<any[]>(sql);

  console.log("\n=== FINANCIAL SNAPSHOT (READ-ONLY) ===\n");

  // Row counts for the transactional tables a revenue reset would touch.
  const tables = [
    "Transaction", "WalletTxn", "CommissionCredit", "TdsLedgerEntry",
    "PosSettlementEntry", "PgSettlementEntry", "QrClaim", "PosTransactionMirror",
    "PayoutRequest", "NetworkWalletTransfer", "HierarchyTransfer",
    "Reversal", "WalletLien", "WalletOperation", "FundRequest",
    "SettlementRun", "SettlementAlert", "AepsSettlement",
    "PosSubscription", "PosRentalInvoice",
    "Invite", "Notification", "AuditLog", "Dispute", "Session",
  ];
  console.log("ROW COUNTS:");
  for (const t of tables) {
    try {
      const r = await q(`SELECT COUNT(*)::int AS c FROM "${t}"`);
      const n = r[0]?.c ?? 0;
      console.log(`  ${t.padEnd(24)} ${n}`);
    } catch (e) {
      console.log(`  ${t.padEnd(24)} (err: ${(e as Error).message})`);
    }
  }

  // WalletTxn split by book.
  console.log("\nWalletTxn BY walletType:");
  const byBook = await q(
    `SELECT "walletType" AS book, COUNT(*)::int AS c FROM "WalletTxn" GROUP BY "walletType" ORDER BY c DESC`
  );
  for (const b of byBook) console.log(`  ${String(b.book).padEnd(12)} ${b.c}`);

  // Balances across users.
  console.log("\nUSER BALANCES (denormalized columns):");
  const bal = await q(`
    SELECT
      COALESCE(SUM("walletBalance"),0)::float8   AS wallet,
      COALESCE(SUM("heldBalance"),0)::float8      AS held,
      COALESCE(SUM("lienBalance"),0)::float8      AS lien,
      COALESCE(SUM("aepsBalance"),0)::float8      AS aeps,
      COALESCE(SUM("revenueBalance"),0)::float8   AS revenue,
      COALESCE(SUM("payinBalance"),0)::float8     AS payin
    FROM "User"`);
  console.log(`  Σ walletBalance : ${bal[0].wallet}`);
  console.log(`  Σ heldBalance   : ${bal[0].held}`);
  console.log(`  Σ lienBalance   : ${bal[0].lien}`);
  console.log(`  Σ aepsBalance   : ${bal[0].aeps}`);
  console.log(`  Σ revenueBalance: ${bal[0].revenue}   <- Revenue Wallet`);
  console.log(`  Σ payinBalance  : ${bal[0].payin}      <- Payin monitor`);

  // Which users actually hold spendable money (real-money risk if zeroed).
  console.log("\nUSERS WITH NON-ZERO walletBalance (top 20):");
  const holders = await q(`
    SELECT "userCode", "name", "role", "walletBalance"::float8 AS bal
    FROM "User"
    WHERE "walletBalance" <> 0
    ORDER BY "walletBalance" DESC
    LIMIT 20`);
  if (holders.length === 0) console.log("  (none — no user holds spendable balance)");
  for (const h of holders) {
    console.log(`  ${String(h.userCode ?? "—").padEnd(8)} ${String(h.name).slice(0, 28).padEnd(30)} ${String(h.role).padEnd(18)} ₹${h.bal}`);
  }
  const holderCount = await q(`SELECT COUNT(*)::int AS c FROM "User" WHERE "walletBalance" <> 0`);
  console.log(`  total holders: ${holderCount[0].c}`);

  // Revenue account identity.
  const owner = await q(`
    SELECT id, "userCode", name, "revenueBalance"::float8 AS rev, "payinBalance"::float8 AS pay
    FROM "User" WHERE role = 'MASTER_ADMIN' AND "deletedAt" IS NULL
    ORDER BY "createdAt" ASC LIMIT 1`);
  console.log("\nREVENUE/PAYIN ACCOUNT (oldest MASTER_ADMIN):");
  if (owner[0]) {
    console.log(`  ${owner[0].userCode ?? "—"} ${owner[0].name}  revenueBalance=₹${owner[0].rev}  payinBalance=₹${owner[0].pay}`);
  }

  // Transaction date range (are these test txns, and when).
  const txnRange = await q(`
    SELECT MIN("createdAt") AS first, MAX("createdAt") AS last, COUNT(*)::int AS c
    FROM "Transaction"`);
  console.log("\nTRANSACTION RANGE:");
  console.log(`  count=${txnRange[0].c}  first=${txnRange[0].first?.toISOString?.() ?? txnRange[0].first}  last=${txnRange[0].last?.toISOString?.() ?? txnRange[0].last}`);

  console.log("\n=== end snapshot (no changes) ===\n");
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
