import { prisma } from "../db";
import { NETWORK_TIERS, type DbRole } from "../hierarchy";
import type { SessionUser } from "../auth-server";

/**
 * Monthly Re-KYC enforcement (Phase 13).
 *
 * Only the registered person may operate the account: on the 1st of every month
 * the scheduler raises `reKycRequired` for every ACTIVE network-tier user
 * (RT/DT/MD/SD). Until they re-verify, every money/transaction route must refuse
 * the operation BEFORE touching the ledger. Login stays open so they can
 * complete re-KYC; only transacting is blocked.
 *
 * Staff/admin roles (ADMIN, SUPPORT, MASTER_ADMIN) are never subject to the gate.
 */

const NETWORK_TIER_SET = new Set<string>(NETWORK_TIERS as DbRole[]);

/** True for the four network tiers that are subject to the monthly gate. */
export function isNetworkTier(role: string): boolean {
  return NETWORK_TIER_SET.has(role);
}

export class ReKycRequiredError extends Error {
  public statusCode = 403;
  public code = "REKYC_REQUIRED" as const;
  constructor(
    message = "Monthly identity re-verification is required before you can transact.",
    public dueAt: string | null = null
  ) {
    super(message);
    this.name = "ReKycRequiredError";
  }
}

/**
 * Whether a network user's re-KYC is currently due. True when the flag is
 * already raised OR the scheduled due date has arrived. Making the gate
 * due-date aware (not just flag-driven) lets an admin reschedule re-KYC to ANY
 * day — the user is re-blocked the moment that day arrives, without waiting for
 * the monthly (1st-of-month) sweep, and the gate stays correct even if the
 * scheduled sweep is missed.
 */
export function isReKycDue(
  reKycRequired: boolean,
  reKycDueAt: Date | null,
  now: Date = new Date()
): boolean {
  if (reKycRequired) return true;
  return reKycDueAt != null && now.getTime() >= reKycDueAt.getTime();
}

/**
 * Throw {@link ReKycRequiredError} (403, code REKYC_REQUIRED) when a network-tier
 * user has an open monthly re-KYC requirement. No-op for staff/admin roles and
 * for network users who are current.
 *
 * Cheap by design: staff roles never hit the database; network users incur a
 * single primary-key lookup of the gate flag. When the due date has arrived but
 * the flag was not yet raised (e.g. an admin postponed to a mid-month day), we
 * lazily persist `reKycRequired` so downstream reads and the gate modal agree.
 */
export async function assertKycCurrent(user: SessionUser): Promise<void> {
  if (!isNetworkTier(user.role)) return;

  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { reKycRequired: true, reKycDueAt: true },
  });
  if (!row) return;

  if (!isReKycDue(row.reKycRequired, row.reKycDueAt)) return;

  // Due date reached without the flag set → raise it now so status reads and
  // the blocking modal stay consistent with this refusal.
  if (!row.reKycRequired) {
    await prisma.user
      .update({ where: { id: user.id }, data: { reKycRequired: true } })
      .catch(() => {});
  }

  throw new ReKycRequiredError(undefined, row.reKycDueAt?.toISOString() ?? null);
}
