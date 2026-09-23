/**
 * Delete the two TESTING brands completely, with all of their history:
 *
 *   • Test_Api               (key: test-api)
 *   • Sameday-Travels Test   (key: sameday-travels-test)
 *
 * For each brand this removes, in FK-safe order:
 *   • POS machines whose acquiring `company` == the brand name (the hand-made
 *     test terminals), together with their rental subscriptions (+ invoices,
 *     cascade), settlement entries, and assignment logs (cascade on machine).
 *   • The brand's MDR rate card (cascade on brand delete, done explicitly).
 *   • The brand row itself.
 *
 * The AuditLog trail is intentionally append-only (enforced by a DB trigger),
 * so those rows are LEFT INTACT — an audit trail is meant to survive the
 * deletion of the entity it describes. We report the count for transparency
 * but never delete them.
 *
 * A machine already linked to a DIFFERENT brand is left untouched (we only
 * pull machines whose company label matches the brand being deleted).
 *
 * SAFETY: DRY-RUN by default; pass `--apply` to write. All writes for both
 * brands run inside ONE transaction, so it is all-or-nothing.
 *
 *   npx tsx scripts/delete-test-brands.ts [--apply]
 */
export {};
try { (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.(); } catch {}

const BRAND_KEYS = ["test-api", "sameday-travels-test"];

async function main() {
  const apply = process.argv.slice(2).includes("--apply");
  const { prisma } = await import("@/lib/db");

  console.log(`\n${apply ? "APPLY" : "DRY-RUN"} — deleting ${BRAND_KEYS.length} test brand(s) with history\n`);

  type Plan = {
    brandId: string;
    brandName: string;
    rateIds: string[];
    machineIds: string[];
    subscriptionIds: string[];
    invoiceIds: string[];
    settlementIds: string[];
    assignmentLogIds: string[];
    auditCount: number;
  };
  const plans: Plan[] = [];

  for (const key of BRAND_KEYS) {
    const brand = await prisma.brand.findUnique({ where: { key } });
    if (!brand) {
      console.log(`  key "${key}"  →  NOT FOUND (skipped)\n`);
      continue;
    }

    const rates = await prisma.brandMdrRate.findMany({ where: { brandId: brand.id }, select: { id: true } });
    const machines = await prisma.posMachine.findMany({
      where: { company: { equals: brand.name.trim(), mode: "insensitive" } },
      select: { id: true, externalId: true, tid: true, brandId: true, assignedUserId: true },
    });
    const machineIds = machines.map((m) => m.id);

    const subs = machineIds.length
      ? await prisma.posSubscription.findMany({ where: { machineId: { in: machineIds } }, select: { id: true } })
      : [];
    const subscriptionIds = subs.map((s) => s.id);
    const invoices = subscriptionIds.length
      ? await prisma.posRentalInvoice.findMany({ where: { subscriptionId: { in: subscriptionIds } }, select: { id: true } })
      : [];
    const settlements = machineIds.length
      ? await prisma.posSettlementEntry.findMany({ where: { machineId: { in: machineIds } }, select: { id: true } })
      : [];
    const assignmentLogs = machineIds.length
      ? await prisma.posAssignmentLog.findMany({ where: { machineId: { in: machineIds } }, select: { id: true } })
      : [];

    const auditEntityIds = [brand.id, ...machineIds, ...subscriptionIds];
    const auditCount = await prisma.auditLog.count({ where: { entityId: { in: auditEntityIds } } });

    console.log(`  ${brand.name}  [key=${brand.key}]  id=${brand.id}`);
    console.log(`    rates=${rates.length}  machines=${machines.length}  subscriptions=${subscriptionIds.length}  invoices=${invoices.length}  settlementEntries=${settlements.length}  assignmentLogs=${assignmentLogs.length}  auditLogs=${auditCount} (kept — append-only)`);
    for (const m of machines) {
      console.log(`      machine ${m.externalId}  tid=${m.tid ?? "—"}  assigned=${m.assignedUserId ?? "no"}  brandId=${m.brandId ?? "null"}`);
    }
    console.log("");

    plans.push({
      brandId: brand.id,
      brandName: brand.name,
      rateIds: rates.map((r) => r.id),
      machineIds,
      subscriptionIds,
      invoiceIds: invoices.map((i) => i.id),
      settlementIds: settlements.map((s) => s.id),
      assignmentLogIds: assignmentLogs.map((a) => a.id),
      auditCount,
    });
  }

  if (!apply) {
    console.log("Re-run with --apply to perform the deletion (single transaction).\n");
    await prisma.$disconnect();
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const p of plans) {
      // Children first, then parents (explicit even where cascades exist).
      if (p.invoiceIds.length) await tx.posRentalInvoice.deleteMany({ where: { id: { in: p.invoiceIds } } });
      if (p.subscriptionIds.length) await tx.posSubscription.deleteMany({ where: { id: { in: p.subscriptionIds } } });
      if (p.settlementIds.length) await tx.posSettlementEntry.deleteMany({ where: { id: { in: p.settlementIds } } });
      if (p.assignmentLogIds.length) await tx.posAssignmentLog.deleteMany({ where: { id: { in: p.assignmentLogIds } } });
      if (p.machineIds.length) await tx.posMachine.deleteMany({ where: { id: { in: p.machineIds } } });
      if (p.rateIds.length) await tx.brandMdrRate.deleteMany({ where: { id: { in: p.rateIds } } });
      await tx.brand.delete({ where: { id: p.brandId } });
      console.log(`  ✓ deleted "${p.brandName}" and its history (${p.auditCount} audit row(s) preserved)`);
    }
  });

  console.log("\nDone.\n");
  await prisma.$disconnect();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
