/** READ-ONLY. Recent BBPS credit-card outcomes. Mutates nothing. */
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

async function main() {
  const { prisma } = await import("../src/lib/db");
  const since = new Date(Date.now() - 2 * 60 * 60_000);
  const rows = await prisma.transaction.findMany({
    where: { service: "BILL_CREDIT_CARD", createdAt: { gte: since } },
    select: { status: true, createdAt: true, operator: true, customer: true, errorMessage: true },
    orderBy: { createdAt: "desc" },
  });
  const byStatus: Record<string, number> = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  console.log("=== last 2h BILL_CREDIT_CARD by status ===");
  console.log(JSON.stringify(byStatus), "total:", rows.length);

  console.log("\n=== most recent 12 attempts ===");
  for (const r of rows.slice(0, 12)) {
    const t = r.createdAt.toISOString().slice(11, 19);
    console.log(`${t}  ${r.status.padEnd(12)} ${String(r.operator ?? "").padEnd(26)} card=${r.customer ?? "?"}  ${r.errorMessage ? r.errorMessage.slice(0, 50) : ""}`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
