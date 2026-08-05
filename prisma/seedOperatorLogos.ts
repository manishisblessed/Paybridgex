/**
 * Populate `Operator.logoUrl` for existing operator/biller master rows using
 * the shared brand-logo resolver. Safe to re-run (idempotent); only rows whose
 * name/code resolves to a known brand are updated.
 *
 *   npm run db:seed:logos
 */
import { PrismaClient } from "@prisma/client";
import { brandLogoUrl } from "../src/lib/brand/logos";

const prisma = new PrismaClient();

async function main() {
  console.log("→ Seeding Operator.logoUrl from the brand table…");
  const operators = await prisma.operator.findMany({
    select: { id: true, name: true, code: true, logoUrl: true },
  });

  let updated = 0;
  let skipped = 0;
  for (const o of operators) {
    const url = brandLogoUrl(o.name) ?? brandLogoUrl(o.code);
    if (!url) {
      skipped++;
      continue;
    }
    if (o.logoUrl === url) continue;
    await prisma.operator.update({ where: { id: o.id }, data: { logoUrl: url } });
    updated++;
    console.log(`  ✓ ${o.name} → ${url}`);
  }

  console.log(`✔ Done. Updated ${updated}, unmatched ${skipped}, total ${operators.length}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
