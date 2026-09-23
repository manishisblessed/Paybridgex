/**
 * Backfill: attach POS machines to the Brand that owns their acquiring company
 * so the Brands (MDR) page "Machines" count reflects the fleet and captures
 * price off the brand's rate card.
 *
 * Matches `PosMachine.company` to `Brand.name` (case-insensitive) and fills
 * ONLY rows whose `brandId` is still null — a machine already linked (manually
 * or to another brand) is never re-homed. Idempotent.
 *
 * SAFETY: DRY-RUN by default; pass `--apply` to write.
 *
 *   npx tsx scripts/link-pos-machines-to-brands.ts [--apply]
 */
export {};
try { (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.(); } catch {}

async function main() {
  const apply = process.argv.slice(2).includes("--apply");
  const { prisma } = await import("@/lib/db");

  const brands = await prisma.brand.findMany({ select: { id: true, name: true, active: true } });

  console.log(`\n${apply ? "APPLY" : "DRY-RUN"} — linking unlinked POS machines to brands by company\n`);

  let total = 0;
  for (const b of brands) {
    const name = b.name.trim();
    if (!name) continue;
    const where = { brandId: null, company: { equals: name, mode: "insensitive" as const } };
    const pending = await prisma.posMachine.count({ where });
    if (pending === 0) continue;
    total += pending;
    console.log(`  ${b.active ? "✓" : "·"} ${name}  →  ${pending} machine(s) to link  [brand ${b.id}]`);
    if (apply) {
      const res = await prisma.posMachine.updateMany({ where, data: { brandId: b.id } });
      console.log(`      linked ${res.count}`);
    }
  }

  console.log(`\n  ${total} machine(s) ${apply ? "linked" : "would be linked"}.`);
  if (!apply) console.log("  Re-run with --apply to write.\n");
  await prisma.$disconnect();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
