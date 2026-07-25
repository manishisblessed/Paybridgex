import { prisma } from "@/lib/db";
import { posCompanyLabel } from "@/lib/pos/assignments";

/**
 * One-time backfill: set PosMachine.company = "Sameday-<model>" for every
 * machine, derived from its existing `model` column. Going forward the sync
 * derives the same label, so this only matters for rows already mirrored
 * before the change. Safe to re-run (idempotent).
 */
(async () => {
  const machines = await prisma.posMachine.findMany({
    select: { id: true, model: true, company: true },
  });

  let updated = 0;
  let cleared = 0;
  let unchanged = 0;

  for (const m of machines) {
    const next = posCompanyLabel(m.model);
    if (next === m.company) {
      unchanged++;
      continue;
    }
    await prisma.posMachine.update({
      where: { id: m.id },
      data: { company: next },
    });
    if (next) updated++;
    else cleared++;
  }

  const distinct = await prisma.posMachine.groupBy({
    by: ["company"],
    where: { company: { not: null } },
    _count: { _all: true },
  });

  console.log(`SCANNED ${machines.length}`);
  console.log(`UPDATED ${updated}  CLEARED ${cleared}  UNCHANGED ${unchanged}`);
  console.log("COMPANIES:");
  for (const g of distinct.sort((a, b) => (a.company ?? "").localeCompare(b.company ?? ""))) {
    console.log(`  ${g.company}  (${g._count._all})`);
  }

  process.exit(0);
})();
