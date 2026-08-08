/**
 * Backfill `VerificationResult.userId` from the linked invite.
 *
 * Onboarding eKYC results (PAN_360, BANK_PENNY_DROP, AADHAAR_DIGILOCKER, GST,
 * DOCUMENT_*, SELFIE, ONBOARD_VIDEO, …) are created against the *invite* with
 * `userId = invite.userId`, which is NULL until the applicant registers. The
 * `userId` is only backfilled at registration (`register` route's updateMany).
 *
 * Legacy accounts registered before that backfill existed — plus any edge case
 * where the relink didn't run — therefore keep `userId = NULL` on their
 * verifications even though the invite IS owned by a real user. Anything that
 * queries verifications by `userId` (the admin KYC queue's PAN / bank / status /
 * documents fallbacks, reports, etc.) then shows blanks.
 *
 * This script sets `userId = invite.userId` for every verification that is still
 * NULL but tied to an invite that has a real owner. Because it only ever fills a
 * NULL (never overwrites an existing userId), it is safe and idempotent —
 * re-running after `--apply` is a no-op.
 *
 * SAFETY: dry-run by default — it only PRINTS what would change. Pass `--apply`
 * to actually write.
 *
 * Run (PowerShell, repo root, with DATABASE_URL set):
 *   npx tsx scripts/backfillVerificationUserIds.ts            # dry-run (no writes)
 *   npx tsx scripts/backfillVerificationUserIds.ts --apply    # write changes
 */
import "./_load-env";
import { prisma } from "../src/lib/db";

const APPLY = process.argv.includes("--apply");

async function main() {
  const startedAt = new Date();
  console.log(
    `[backfillVerificationUserIds] starting at ${startedAt.toISOString()} — mode: ${
      APPLY ? "APPLY (writing)" : "DRY-RUN (no writes)"
    }`
  );

  // Verifications missing a userId but still tied to an invite.
  const orphans = await prisma.verificationResult.findMany({
    where: { userId: null, inviteId: { not: null } },
    select: { id: true, inviteId: true, type: true },
  });

  if (orphans.length === 0) {
    console.log(
      "[backfillVerificationUserIds] no invite-linked verifications with a NULL userId — nothing to do."
    );
    return;
  }

  const inviteIds = Array.from(
    new Set(orphans.map((o) => o.inviteId).filter((v): v is string => !!v))
  );

  // Only invites that are actually owned by a user can be backfilled.
  const invites = await prisma.invite.findMany({
    where: { id: { in: inviteIds }, userId: { not: null } },
    select: { id: true, userId: true },
  });
  const inviteToUser = new Map<string, string>();
  for (const i of invites) if (i.userId) inviteToUser.set(i.id, i.userId);

  const linkable = orphans.filter((o) => o.inviteId && inviteToUser.has(o.inviteId));
  const unlinkable = orphans.length - linkable.length;

  // Per-type breakdown of what will be relinked (for visibility).
  const byType = new Map<string, number>();
  for (const o of linkable) byType.set(o.type, (byType.get(o.type) ?? 0) + 1);
  const affectedUsers = new Set(
    linkable.map((o) => inviteToUser.get(o.inviteId as string) as string)
  );

  console.log(
    `[backfillVerificationUserIds] ${orphans.length} verification(s) have a NULL userId; ` +
      `${linkable.length} are linkable across ${affectedUsers.size} user(s); ` +
      `${unlinkable} cannot be linked (invite has no owner / was purged).`
  );
  console.log("[backfillVerificationUserIds] linkable breakdown by type:");
  for (const [type, count] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  - ${type}: ${count}`);
  }

  if (linkable.length === 0) {
    console.log(
      "[backfillVerificationUserIds] nothing linkable — all NULL-userId verifications belong to ownerless invites."
    );
    return;
  }

  if (!APPLY) {
    console.log(
      "\n[backfillVerificationUserIds] DRY-RUN complete. No changes written. Re-run with --apply to commit."
    );
    return;
  }

  // Apply grouped by invite. `userId: null` in the WHERE keeps it idempotent and
  // guarantees we never overwrite an already-linked verification.
  let updated = 0;
  for (const inv of invites) {
    const res = await prisma.verificationResult.updateMany({
      where: { inviteId: inv.id, userId: null },
      data: { userId: inv.userId as string },
    });
    updated += res.count;
  }

  console.log(
    `\n[backfillVerificationUserIds] done — relinked ${updated} verification(s) to their owner.`
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[backfillVerificationUserIds] FAILED:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
