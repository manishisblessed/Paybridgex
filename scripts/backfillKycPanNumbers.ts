/**
 * Backfill `Kyc.panNumber` from the verified `PAN_360` onboarding record.
 *
 * A user's PAN is captured and verified during onboarding and stored in the
 * `PAN_360` `VerificationResult` payload, but the value is not always written
 * back onto `Kyc.panNumber`. Anything that reads `Kyc.panNumber` directly (the
 * TDS / Form 26Q report, exports, etc.) then shows "—" even though a verified
 * PAN exists in the system. The KYC review screen and the TDS report both have a
 * read-time fallback to the verification payload, but the underlying `Kyc` row
 * stays empty — this script makes the stored data consistent everywhere.
 *
 * For every `Kyc` row with a NULL `panNumber`, it looks up the user's latest
 * successful `PAN_360` verification (resolved by `userId` OR the user's invite
 * id, since onboarding verifications are created against the invite and only get
 * `userId` backfilled at registration) and writes the verified PAN back onto the
 * `Kyc` row.
 *
 * SAFETY:
 *   - Only ever fills a NULL `panNumber` (never overwrites an existing value),
 *     so it is safe and idempotent — re-running after `--apply` is a no-op.
 *   - `Kyc.panNumber` is `@unique`; if a verified PAN collides with a PAN
 *     already stored on another Kyc row, that update is skipped and reported
 *     rather than crashing the run.
 *   - Users that have a verified PAN but no `Kyc` row at all are only reported,
 *     never created (KYC status lifecycle is left untouched).
 *   - Dry-run by default: it only PRINTS what would change. Pass `--apply` to
 *     actually write.
 *
 * Run (PowerShell, repo root, with DATABASE_URL set):
 *   npx tsx scripts/backfillKycPanNumbers.ts            # dry-run (no writes)
 *   npx tsx scripts/backfillKycPanNumbers.ts --apply    # write changes
 */
import "./_load-env";
import { prisma } from "../src/lib/db";
import { Prisma } from "@prisma/client";

const APPLY = process.argv.includes("--apply");

/** Extract an uppercased PAN from a PAN_360 request/response payload. */
function extractPan(
  requestPayload: Prisma.JsonValue | null,
  responsePayload: Prisma.JsonValue | null
): string | null {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const req = (requestPayload ?? {}) as any;
  const res = (responsePayload ?? {}) as any;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const pan = String(req.pan ?? res.pan ?? "").trim().toUpperCase();
  return pan || null;
}

async function main() {
  const startedAt = new Date();
  console.log(
    `[backfillKycPanNumbers] starting at ${startedAt.toISOString()} — mode: ${
      APPLY ? "APPLY (writing)" : "DRY-RUN (no writes)"
    }`
  );

  // 1. Kyc rows that are missing a PAN — the only rows we might fill.
  const missing = await prisma.kyc.findMany({
    where: { panNumber: null },
    select: { userId: true },
  });
  if (missing.length === 0) {
    console.log("[backfillKycPanNumbers] no Kyc rows with a NULL panNumber — nothing to do.");
    return;
  }
  const userIds = missing.map((k) => k.userId);
  console.log(`[backfillKycPanNumbers] ${userIds.length} Kyc row(s) missing a PAN.`);

  // 2. Resolve those users' invites so we can match verifications created
  //    against the invite (userId only backfilled at registration).
  const invites = await prisma.invite.findMany({
    where: { userId: { in: userIds } },
    select: { id: true, userId: true },
  });
  const inviteToUser = new Map<string, string>();
  const inviteIds: string[] = [];
  for (const inv of invites) {
    inviteIds.push(inv.id);
    if (inv.userId) inviteToUser.set(inv.id, inv.userId);
  }

  // 3. Latest successful PAN_360 verification per user (rows are newest-first).
  const rows = await prisma.verificationResult.findMany({
    where: {
      type: "PAN_360",
      status: "Success",
      OR: [
        { userId: { in: userIds } },
        ...(inviteIds.length ? [{ inviteId: { in: inviteIds } }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    select: { userId: true, inviteId: true, requestPayload: true, responsePayload: true },
  });

  const panByUser = new Map<string, string>();
  for (const v of rows) {
    const owner = v.userId ?? (v.inviteId ? inviteToUser.get(v.inviteId) ?? null : null);
    if (!owner || !userIds.includes(owner) || panByUser.has(owner)) continue;
    const pan = extractPan(v.requestPayload, v.responsePayload);
    if (pan) panByUser.set(owner, pan);
  }

  const fillable = userIds.filter((id) => panByUser.has(id));
  const noVerifiedPan = userIds.length - fillable.length;

  console.log(
    `[backfillKycPanNumbers] ${fillable.length} row(s) have a verified PAN to backfill; ` +
      `${noVerifiedPan} have no verified PAN_360 record (left as-is).`
  );

  if (fillable.length === 0) {
    console.log("[backfillKycPanNumbers] nothing to backfill.");
    return;
  }

  // Sample of what will change (avoid dumping every PAN to the console).
  console.log("[backfillKycPanNumbers] sample of planned updates (up to 10):");
  for (const id of fillable.slice(0, 10)) {
    console.log(`  - user ${id} -> ${panByUser.get(id)}`);
  }

  if (!APPLY) {
    console.log(
      "\n[backfillKycPanNumbers] DRY-RUN complete. No changes written. Re-run with --apply to commit."
    );
    return;
  }

  // 4. Apply. `panNumber: null` in the WHERE keeps it idempotent (never
  //    overwrites). Unique-constraint collisions are skipped and reported.
  let updated = 0;
  const conflicts: { userId: string; pan: string }[] = [];
  for (const id of fillable) {
    const pan = panByUser.get(id) as string;
    try {
      const res = await prisma.kyc.updateMany({
        where: { userId: id, panNumber: null },
        data: { panNumber: pan },
      });
      updated += res.count;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        conflicts.push({ userId: id, pan });
      } else {
        throw err;
      }
    }
  }

  console.log(`\n[backfillKycPanNumbers] done — backfilled ${updated} Kyc row(s).`);
  if (conflicts.length > 0) {
    console.log(
      `[backfillKycPanNumbers] ${conflicts.length} row(s) skipped — PAN already assigned to ` +
        `another Kyc row (possible duplicate/shared PAN). Review manually:`
    );
    for (const c of conflicts) console.log(`  - user ${c.userId} -> ${c.pan}`);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[backfillKycPanNumbers] FAILED:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
