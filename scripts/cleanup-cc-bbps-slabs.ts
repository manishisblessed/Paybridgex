/**
 * Remove BBPS scheme slabs pinned to the wrong product:
 *   - Credit Card Bill Payment / CC-2 on a non-CC bill category
 *   - Bharat BillPay / Unified on BILL_CREDIT_CARD
 *
 * Usage:
 *   npx tsx scripts/cleanup-cc-bbps-slabs.ts            # dry-run
 *   npx tsx scripts/cleanup-cc-bbps-slabs.ts --commit   # delete
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
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[m[1]] === undefined) process.env[m[1]] = val;
    }
  }
}
loadEnvFile();

const COMMIT = process.argv.includes("--commit");

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { isBbpsServiceProviderCompatible } = await import("../src/lib/services/priceScope");

  console.log(`\n=== Cleanup mismatched BBPS slabs (${COMMIT ? "COMMIT" : "DRY-RUN"}) ===\n`);

  const billServices = [
    "BILL_ELECTRICITY",
    "BILL_WATER",
    "BILL_GAS",
    "BILL_CREDIT_CARD",
    "BILL_EDUCATION",
    "BILL_INSURANCE",
  ] as const;

  const slabs = await prisma.schemeSlab.findMany({
    where: { service: { in: [...billServices] }, provider: { not: null } },
    include: { scheme: { select: { name: true } } },
    orderBy: [{ schemeId: "asc" }, { service: "asc" }],
  });

  const stale = slabs.filter((s) => !isBbpsServiceProviderCompatible(s.service, s.provider));

  console.log(`BBPS bill slabs with a provider : ${slabs.length}`);
  console.log(`  mismatched (will remove)      : ${stale.length}\n`);

  for (const s of stale) {
    console.log(
      `✂ ${s.scheme.name}  ${s.service}  provider=${s.provider}  ₹${Number(s.minAmount)}–₹${Number(s.maxAmount)}`
    );
  }

  if (!COMMIT) {
    console.log(`\n(dry-run) Re-run with --commit to delete ${stale.length} slab(s).\n`);
    await prisma.$disconnect();
    return;
  }

  if (stale.length) {
    const result = await prisma.schemeSlab.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
    console.log(`\n✓ Deleted ${result.count} mismatched slab(s).\n`);
  } else {
    console.log("\n• Nothing to delete.\n");
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("\n✗ Cleanup failed:", e);
  process.exit(1);
});
