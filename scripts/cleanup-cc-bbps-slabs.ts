/**
 * Remove BBPS scheme slabs that pin a credit-card-only product
 * (Credit Card Bill Payment / Credit Card Bill Payment-2) onto a non-CC
 * bill category (electricity, water, gas, education, insurance). Those rows
 * were created by the old "All Services" fan-out in Scheme Manager.
 *
 * BILL_CREDIT_CARD slabs on those products are kept. Bharat BillPay
 * (bbps_sameday) slabs on utilities are kept — that product really does
 * cover every bill category.
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
  const { BBPS_PRICE_SCOPES, isBbpsServiceProviderCompatible } = await import(
    "../src/lib/services/priceScope"
  );

  const ccProviders = [BBPS_PRICE_SCOPES.BBPS_CREDIT_CARD, BBPS_PRICE_SCOPES.RECHARGEKIT_CC];

  console.log(`\n=== Cleanup CC-only BBPS slabs on non-CC categories (${COMMIT ? "COMMIT" : "DRY-RUN"}) ===\n`);

  const slabs = await prisma.schemeSlab.findMany({
    where: { provider: { in: ccProviders } },
    include: { scheme: { select: { name: true } } },
    orderBy: [{ schemeId: "asc" }, { service: "asc" }],
  });

  const stale = slabs.filter((s) => !isBbpsServiceProviderCompatible(s.service, s.provider));
  const keep = slabs.filter((s) => isBbpsServiceProviderCompatible(s.service, s.provider));

  console.log(`CC-product slabs found : ${slabs.length}`);
  console.log(`  keep (BILL_CREDIT_CARD) : ${keep.length}`);
  console.log(`  remove (wrong category) : ${stale.length}\n`);

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
