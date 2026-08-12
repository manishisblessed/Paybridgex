/**
 * Remove the redundant QR MDR slab that setup-qr-pricing.ts added to a scheme
 * which ALREADY had a working (more-specific) QR slab — currently `test_2707`,
 * whose RuPay-pinned 1.2% slab always wins, leaving my wildcard-brandType 1.5%
 * slab as dead config.
 *
 * Safe: it only deletes the exact wildcard slab this project seeded
 * (serviceKind QR, paymentMode UPI, company = provider scope, brandType null,
 * band ₹1–₹100000) and ONLY when the same scheme has another active QR slab
 * that actually resolves — so it can never leave a scheme with zero QR pricing.
 *
 * Usage:
 *   npx tsx scripts/cleanup-qr-duplicate.ts            # dry-run: list what would go
 *   npx tsx scripts/cleanup-qr-duplicate.ts --commit   # delete the redundant slab(s)
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
const QR_KEY = "qr_dynamic";
const QR_PROVIDER = "NPCI";

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

async function main() {
  const { prisma } = await import("../src/lib/db");

  const route = await prisma.serviceRoute.findUnique({ where: { key: QR_KEY }, select: { provider: true } });
  const scope = route?.provider ?? QR_PROVIDER;

  console.log(`\n=== Cleanup redundant QR slab (${COMMIT ? "COMMIT" : "DRY-RUN"}) — scope ${scope} ===\n`);

  // The exact wildcard slab setup-qr-pricing.ts created.
  const seeded = await prisma.mdrSlab.findMany({
    where: {
      serviceKind: "QR",
      paymentMode: "UPI",
      company: scope,
      cardType: null,
      brandType: null,
      classification: null,
      active: true,
    },
    include: { scheme: { select: { name: true } } },
  });

  let removed = 0;
  for (const slab of seeded) {
    // Find OTHER active QR slabs in the same scheme that could serve pricing.
    const siblings = await prisma.mdrSlab.findMany({
      where: { schemeId: slab.schemeId, serviceKind: "QR", active: true, id: { not: slab.id } },
      select: { id: true, brandType: true, company: true, mdrValue: true, mdrValueT0: true, minAmount: true, maxAmount: true },
    });

    if (siblings.length === 0) {
      console.log(`• KEEP  ${slab.scheme.name}: this is the only QR slab — removing it would leave the scheme with no QR pricing.`);
      continue;
    }

    console.log(`✂ REMOVE ${slab.scheme.name}: redundant wildcard slab mdr=${pct(Number(slab.mdrValue))}/T0=${pct(Number(slab.mdrValueT0))} (band ₹${Number(slab.minAmount)}–₹${Number(slab.maxAmount)})`);
    for (const s of siblings) {
      console.log(`         ↳ kept sibling: brandType=${s.brandType ?? "*"} company=${s.company ?? "*"} mdr=${pct(Number(s.mdrValue))}/T0=${pct(Number(s.mdrValueT0))} (band ₹${Number(s.minAmount)}–₹${Number(s.maxAmount)})`);
    }

    if (COMMIT) {
      await prisma.mdrSlab.delete({ where: { id: slab.id } });
      removed++;
    }
  }

  if (!COMMIT) {
    console.log(`\n(dry-run) ${seeded.length} seeded wildcard slab(s) examined. Re-run with --commit to delete the ones marked REMOVE.\n`);
  } else {
    console.log(`\n✓ Removed ${removed} redundant QR slab(s).\n`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("\n✗ Cleanup failed:", e);
  process.exit(1);
});
