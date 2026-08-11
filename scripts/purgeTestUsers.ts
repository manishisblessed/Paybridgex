/**
 * Soft-delete leftover E2E test users that can't be hard-deleted.
 *
 * `scripts/testResubmitFlow.ts` creates throwaway retailers on the reserved
 * `@example.invalid` domain and hard-deletes them on cleanup — EXCEPT any that
 * an append-only AuditLog row references (the `auditlog_append_only` trigger
 * blocks the FK SET NULL). Those survivors get neutralised (CLOSED, renamed
 * "[TEST-DATA] resubmit flow") but still clutter the admin Users list.
 *
 * A physical DELETE is impossible without tearing down the immutable audit
 * trail (an intentional compliance control), so this performs the sanctioned
 * deletion instead: it sets `User.deletedAt`, which the admin Users list now
 * filters out. The audit history stays intact.
 *
 * Only targets the reserved test domain / test marker — it can never match a
 * real user (example.invalid is non-routable and reserved by RFC 6761).
 *
 * SAFETY: dry-run by default. Pass --apply to write.
 *   npx tsx scripts/purgeTestUsers.ts            # dry-run
 *   npx tsx scripts/purgeTestUsers.ts --apply    # soft-delete
 */
import { prisma } from "../src/lib/db";

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(`[purgeTestUsers] mode: ${APPLY ? "APPLY (writing)" : "DRY-RUN (no writes)"}`);

  const targets = await prisma.user.findMany({
    where: {
      deletedAt: null,
      OR: [
        { email: { endsWith: "@example.invalid" } },
        { name: { startsWith: "[TEST-DATA]" } },
      ],
    },
    select: { id: true, name: true, email: true, role: true, status: true },
  });

  if (targets.length === 0) {
    console.log("\nNo un-deleted test users found. Nothing to do.\n");
    return;
  }

  console.log(`\nFound ${targets.length} test user(s) to soft-delete:`);
  for (const u of targets) {
    console.log(`  • ${u.name} — ${u.email} (${u.role}/${u.status}) [${u.id}]`);
  }

  if (!APPLY) {
    console.log("\nDRY-RUN — no changes written. Re-run with --apply to soft-delete.\n");
    return;
  }

  const actor = await prisma.user.findFirst({
    where: { role: "MASTER_ADMIN" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  const now = new Date();
  for (const u of targets) {
    await prisma.$transaction([
      prisma.user.update({ where: { id: u.id }, data: { deletedAt: now } }),
      prisma.auditLog.create({
        data: {
          userId: actor?.id ?? u.id,
          action: "user.test_data_purged",
          entity: "User",
          entityId: u.id,
          meta: { via: "script:purgeTestUsers", email: u.email, name: u.name, reason: "E2E test leftover" },
        },
      }),
    ]);
    console.log(`  ✓ soft-deleted ${u.email}`);
  }

  console.log(`\n✓ Soft-deleted ${targets.length} test user(s). They no longer appear in the admin Users list.\n`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
