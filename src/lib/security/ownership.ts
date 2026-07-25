import { prisma } from "../db";
import { AuthError, type SessionUser } from "../auth-server";

/**
 * Object-level authorization (defense against IDOR / BOLA — the #1 fintech API
 * risk). Role checks alone are not enough: a logged-in retailer must never be
 * able to read another retailer's payout by guessing an id.
 *
 * Access model:
 *   - Admin roles (MASTER_ADMIN, ADMIN, SUPPORT) can access everything.
 *   - A user can always access their own resources.
 *   - A parent in the hierarchy can access their entire downline (descendants).
 */

const ADMIN_ROLES = new Set(["MASTER_ADMIN", "ADMIN", "SUPPORT"]);

export function isAdminRole(role: string): boolean {
  return ADMIN_ROLES.has(role);
}

/** Throw 403 unless `user` owns (or administers) the given resource owner id. */
export function assertOwner(resourceOwnerId: string, user: SessionUser): void {
  if (isAdminRole(user.role)) return;
  if (resourceOwnerId === user.id) return;
  throw new AuthError("Forbidden", 403);
}

/**
 * All descendant user ids beneath `userId` in the hierarchy (excludes self).
 * Uses a single recursive CTE for efficiency.
 */
export async function getDescendantIds(userId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE downline AS (
      SELECT id FROM "User" WHERE "parentId" = ${userId}
      UNION ALL
      SELECT u.id FROM "User" u
      INNER JOIN downline d ON u."parentId" = d.id
    )
    SELECT id FROM downline
  `;
  return rows.map((r) => r.id);
}

/**
 * Immediate children of `userId` (one hierarchy level down only — excludes self
 * and deeper descendants). Used by the POS visibility model where a parent sees
 * only their DIRECT children's terminals: SD→MDs, MD→DTs, DT→RTs.
 */
export async function getDirectChildIds(userId: string): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: { parentId: userId, deletedAt: null },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** True if `targetUserId` is a DIRECT child of `user` (or `user` is self/admin). */
export async function isSelfOrDirectChild(
  targetUserId: string,
  user: SessionUser
): Promise<boolean> {
  if (isAdminRole(user.role)) return true;
  if (targetUserId === user.id) return true;
  const child = await prisma.user.findFirst({
    where: { id: targetUserId, parentId: user.id, deletedAt: null },
    select: { id: true },
  });
  return Boolean(child);
}

/** True if `user` may access data belonging to `targetUserId`. */
export async function canAccessUser(
  targetUserId: string,
  user: SessionUser
): Promise<boolean> {
  if (isAdminRole(user.role)) return true;
  if (targetUserId === user.id) return true;
  const descendants = await getDescendantIds(user.id);
  return descendants.includes(targetUserId);
}

/** Throw 403 unless `user` may access `targetUserId`'s data. */
export async function assertCanAccessUser(
  targetUserId: string,
  user: SessionUser
): Promise<void> {
  if (!(await canAccessUser(targetUserId, user))) {
    throw new AuthError("Forbidden", 403);
  }
}

/**
 * Build a Prisma `userId` filter that scopes a list query to what `user` is
 * allowed to see: everything for admins, otherwise self + downline.
 *
 * Usage:
 *   const where = { ...(await scopeUserIdFilter(user)) };
 *   prisma.payoutRequest.findMany({ where });
 */
export async function scopeUserIdFilter(
  user: SessionUser
): Promise<{ userId?: { in: string[] } }> {
  if (isAdminRole(user.role)) return {};
  const descendants = await getDescendantIds(user.id);
  return { userId: { in: [user.id, ...descendants] } };
}

/**
 * Like `scopeUserIdFilter` but scopes to self + DIRECT children only (one
 * hierarchy level), never the full subtree. This is the POS visibility model:
 * an SD sees only their direct MDs' terminals, an MD only their direct DTs', a
 * DT only their direct RTs'. Admins are unrestricted.
 */
export async function scopeDirectUserIdFilter(
  user: SessionUser
): Promise<{ userId?: { in: string[] } }> {
  if (isAdminRole(user.role)) return {};
  const children = await getDirectChildIds(user.id);
  return { userId: { in: [user.id, ...children] } };
}
