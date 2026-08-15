/**
 * Physically remove StaticQr (collection QR) rows + their Cloudinary images.
 *
 * The app never hard-deletes a QR (the admin "Disable" only flips enabled=false,
 * so historical claims keep their reference). For a pre-go-live cleanup of TEST
 * QRs we remove them outright. Safe now that the revenue reset wiped all QrClaim
 * rows — a QR with 0 claims has nothing pointing at it.
 *
 * SAFETY:
 *   • Dry-run by default. Pass --apply to write.
 *   • Skips any QR that still has QrClaim rows unless --force is given (deleting
 *     one would be blocked by the QrClaim FK).
 *   • Optional label filter: pass one or more labels to target only those;
 *     with no labels it targets ALL StaticQr rows.
 *
 *   npx tsx scripts/removeTestQrs.ts                     # dry-run, all QRs
 *   npx tsx scripts/removeTestQrs.ts --apply             # delete all (0-claim) QRs
 *   npx tsx scripts/removeTestQrs.ts SHAH_Works --apply  # delete only that label
 */
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

const rawArgs = process.argv.slice(2);
const APPLY = rawArgs.includes("--apply");
const FORCE = rawArgs.includes("--force");
const labels = rawArgs.filter((a) => !a.startsWith("--"));

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { deleteFromCloudinary } = await import("../src/lib/cloudinary");

  console.log(`\n=== REMOVE STATIC QRs — mode: ${APPLY ? "APPLY (WRITING)" : "DRY-RUN"} ===`);
  console.log(labels.length ? `Target labels: ${labels.join(", ")}` : "Target: ALL StaticQr rows");

  const qrs = await prisma.staticQr.findMany({
    where: labels.length ? { label: { in: labels } } : {},
    select: {
      id: true,
      label: true,
      upiVpa: true,
      imagePublicId: true,
      enabled: true,
      active: true,
      createdAt: true,
      createdBy: { select: { name: true, userCode: true } },
      _count: { select: { claims: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  if (qrs.length === 0) {
    console.log("\nNo matching StaticQr rows. Nothing to do.\n");
    await prisma.$disconnect();
    return;
  }

  console.log(`\nFound ${qrs.length} QR(s):`);
  for (const q of qrs) {
    console.log(
      `  • ${q.label.padEnd(16)} vpa=${(q.upiVpa ?? "—").padEnd(28)} claims=${q._count.claims}  ${q.active ? "LIVE" : q.enabled ? "enabled" : "disabled"}  by ${q.createdBy?.name ?? "?"}  [${q.id}]`
    );
  }

  const deletable = qrs.filter((q) => q._count.claims === 0 || FORCE);
  const skipped = qrs.filter((q) => q._count.claims > 0 && !FORCE);
  if (skipped.length) {
    console.log(`\n⚠ Skipping ${skipped.length} QR(s) that still have claims (use --force to override):`);
    for (const q of skipped) console.log(`    ${q.label} (${q._count.claims} claims)`);
  }

  if (!APPLY) {
    console.log(`\nDRY-RUN — would delete ${deletable.length} QR(s) and purge their Cloudinary images. Re-run with --apply.\n`);
    await prisma.$disconnect();
    return;
  }

  console.log("\nDeleting…");
  for (const q of deletable) {
    // Purge the Cloudinary image first (QR images are public uploads).
    try {
      const res = await deleteFromCloudinary(q.imagePublicId, { isSensitive: false });
      console.log(`  ✓ cloudinary ${q.label}: ${JSON.stringify(res)}`);
    } catch (e) {
      console.error(`  ✗ cloudinary ${q.label} (${q.imagePublicId}): ${(e as Error).message}`);
    }
    if (FORCE && q._count.claims > 0) {
      await prisma.qrClaim.deleteMany({ where: { qrId: q.id } });
    }
    await prisma.staticQr.delete({ where: { id: q.id } });
    console.log(`  ✓ deleted QR ${q.label}`);
  }

  const remaining = await prisma.staticQr.count();
  console.log(`\n✓ Done. StaticQr rows remaining: ${remaining}.\n`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("\nFATAL:", e);
  process.exit(1);
});
