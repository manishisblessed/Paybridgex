/**
 * Backfill onboarding invites for network users that have none.
 *
 * The Onboarding Invites page (`/dashboard/admin/invites`) reads exclusively
 * from the `Invite` table, whereas the Network page reads from `User`. Any
 * network user created outside the invite flow — legacy accounts, bulk imports,
 * or the admin "Create User" path (`POST /api/admin/users`) — therefore shows
 * up in Network but is INVISIBLE on Onboarding Invites.
 *
 * This script creates one linked invite (`Invite.userId = user.id`) for every
 * network-tier user (RT/DT/MD/SD) that doesn't already have one, so they all
 * surface on the Onboarding Invites page. Because `Invite.userId` is unique,
 * the mapping is strictly one invite per user and the script is idempotent —
 * re-running skips anyone already linked.
 *
 * Invite status mirrors the onboarding decision (see `inviteStatusForUser`):
 *   ACTIVE / SUSPENDED / CLOSED → APPROVED, PENDING_KYC → REGISTERED.
 * Creating an invite row never mutates the user.
 *
 * `invitedById` (required by the schema) is set to the user's parent, falling
 * back to the oldest MASTER_ADMIN for top-level accounts with no parent.
 *
 * SAFETY: dry-run by default — it only PRINTS what would change. Pass `--apply`
 * to actually write.
 *
 * Run (PowerShell, repo root, with DATABASE_URL set):
 *   npx tsx scripts/backfillInvitesForUsers.ts            # dry-run (no writes)
 *   npx tsx scripts/backfillInvitesForUsers.ts --apply    # write invites
 */
import type { Role } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { NETWORK_TIERS } from "../src/lib/hierarchy";
import {
  buildInviteDataForUser,
  inviteStatusForUser,
  type UserForInvite,
} from "../src/lib/onboarding/inviteBackfill";

const APPLY = process.argv.includes("--apply");

async function main() {
  const startedAt = new Date();
  console.log(
    `[backfillInvitesForUsers] starting at ${startedAt.toISOString()} — mode: ${
      APPLY ? "APPLY (writing)" : "DRY-RUN (no writes)"
    }`
  );

  const networkRoles = NETWORK_TIERS as unknown as Role[];

  // Users already linked to an invite — skip them (userId is unique on Invite).
  const linked = await prisma.invite.findMany({
    where: { userId: { not: null } },
    select: { userId: true },
  });
  const linkedUserIds = new Set(linked.map((i) => i.userId as string));

  // Every network-tier user (exclude soft-deleted).
  const users = await prisma.user.findMany({
    where: { role: { in: networkRoles }, deletedAt: null },
    select: {
      id: true,
      email: true,
      phone: true,
      name: true,
      role: true,
      status: true,
      parentId: true,
      phoneVerifiedAt: true,
      emailVerifiedAt: true,
      createdAt: true,
      userCode: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const missing = users.filter((u) => !linkedUserIds.has(u.id));

  console.log(
    `[backfillInvitesForUsers] network users: ${users.length}, already linked: ${
      users.length - missing.length
    }, need backfill: ${missing.length}`
  );

  if (missing.length === 0) {
    console.log("[backfillInvitesForUsers] nothing to do — every network user already has an invite.");
    return;
  }

  // Fallback inviter for top-level accounts (no parent): the oldest MASTER_ADMIN.
  const ownerAdmin = await prisma.user.findFirst({
    where: { role: "MASTER_ADMIN", deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });

  const skipped: { label: string; reason: string }[] = [];
  const plan: { user: UserForInvite & { userCode: string | null }; invitedById: string }[] = [];

  for (const u of missing) {
    const invitedById = u.parentId ?? ownerAdmin?.id;
    if (!invitedById) {
      skipped.push({
        label: `${u.name} (${u.role}) ${u.userCode ?? u.id}`,
        reason: "no parent and no MASTER_ADMIN fallback found",
      });
      continue;
    }
    plan.push({ user: u, invitedById });
  }

  console.log(`[backfillInvitesForUsers] will create ${plan.length} invite(s):`);
  for (const { user: u, invitedById } of plan) {
    const status = inviteStatusForUser(u.status);
    const via = u.parentId ? "parent" : "master-admin fallback";
    console.log(
      `  - ${u.name} (${u.role}) ${u.userCode ?? u.id} · account=${u.status} → invite=${status} · invitedBy=${via}`
    );
  }
  if (skipped.length) {
    console.log(`[backfillInvitesForUsers] ${skipped.length} skipped:`);
    for (const s of skipped) console.log(`  ! ${s.label} — ${s.reason}`);
  }

  if (!APPLY) {
    console.log(
      "\n[backfillInvitesForUsers] DRY-RUN complete. No changes written. Re-run with --apply to commit."
    );
    return;
  }

  let created = 0;
  let failed = 0;
  for (const { user: u, invitedById } of plan) {
    try {
      await prisma.invite.create({ data: buildInviteDataForUser(u, invitedById) });
      created++;
    } catch (e) {
      failed++;
      console.error(
        `  x failed for ${u.name} (${u.userCode ?? u.id}): ${(e as Error).message}`
      );
    }
  }

  console.log(
    `\n[backfillInvitesForUsers] done — created ${created} invite(s), failed ${failed}, skipped ${skipped.length}.`
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[backfillInvitesForUsers] FAILED:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
