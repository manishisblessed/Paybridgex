import type { Role } from "@prisma/client";
import { prisma } from "../db";
import { NETWORK_TIERS } from "../hierarchy";
import { logSecurityEvent } from "../security/audit";
import { firstOfMonthIST } from "./dates";

/**
 * Monthly Re-KYC sweep (Phase 13). Flags every ACTIVE network-tier user
 * (RT/DT/MD/SD — never staff/admin) so they must re-verify their identity
 * before transacting again. Driven by the scheduled `rekyc.monthly` pg-boss job
 * (cron "0 0 1 * *", Asia/Kolkata) and safe to run manually.
 *
 * Idempotent: a user is only (re)flagged when their `reKycDueAt` is missing or
 * older than this month's due date, so re-running on the same day is a no-op
 * and an already-passed user (whose dueAt points at next month) is untouched.
 *
 * Processed in bounded batches with `updateMany` to avoid locking the whole
 * User table on a large network.
 */
export async function runMonthlyReKycSweep(
  batchSize = 500
): Promise<{ flagged: number; dueAt: Date }> {
  const dueAt = firstOfMonthIST();
  const networkRoles = NETWORK_TIERS as unknown as Role[];
  let flagged = 0;

  // Loop a bounded selection → update until no more candidates remain. Each
  // updated row gets reKycDueAt = dueAt, which removes it from the next select.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const batch = await prisma.user.findMany({
      where: {
        role: { in: networkRoles },
        status: "ACTIVE",
        deletedAt: null,
        reKycExempt: false,
        OR: [{ reKycDueAt: null }, { reKycDueAt: { lt: dueAt } }],
      },
      select: { id: true },
      take: batchSize,
    });
    if (batch.length === 0) break;

    const ids = batch.map((u) => u.id);
    await prisma.user.updateMany({
      where: { id: { in: ids } },
      data: { reKycRequired: true, reKycDueAt: dueAt },
    });
    flagged += ids.length;

    if (batch.length < batchSize) break;
  }

  await logSecurityEvent({
    action: "rekyc.sweep",
    severity: "info",
    entity: "User",
    meta: { flagged, dueAt: dueAt.toISOString(), tier: "RT/DT/MD/SD" },
  });

  return { flagged, dueAt };
}
