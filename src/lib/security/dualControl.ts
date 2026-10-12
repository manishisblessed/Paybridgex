/**
 * Dual control (maker-checker) — schema-free.
 *
 * Some actions move real money on an operator's say-so (e.g. force-marking a held
 * payout paid/failed above a threshold). For those we require a SECOND, different
 * admin to approve before the action executes.
 *
 * Implemented purely on AuditLog (no new tables / migration):
 *   • First admin's request records a short-lived "pending" marker and the action
 *     does NOT execute.
 *   • A DIFFERENT admin repeating the same request within the window consumes the
 *     marker (records an "approved" audit pairing maker + checker) and the action
 *     proceeds.
 *   • The same admin repeating it cannot self-approve.
 *
 * Markers expire after `ttlMs` so a stale pending request can't be rubber-stamped
 * days later.
 */
import { prisma } from "@/lib/db";

const DEFAULT_TTL_MS = 30 * 60_000; // a pending request is approvable for 30 min

export type DualControlInput = {
  /** Logical control group, e.g. "payout.force". */
  scope: string;
  /** Specific action within the scope, e.g. "force_paid". Markers are action-specific. */
  action: string;
  entity: string;
  entityId: string;
  actorId: string;
  /** Free-form context stored on the markers (amount, note…). */
  meta?: Record<string, unknown>;
  ttlMs?: number;
};

export type DualControlDecision =
  | { proceed: true; makerId?: string }
  | {
      proceed: false;
      status: "AWAITING_SECOND_APPROVER" | "ALREADY_REQUESTED_BY_YOU";
      message: string;
    };

function pendingAction(scope: string, action: string): string {
  return `dualctl.${scope}.${action}.pending`;
}

/**
 * Evaluate maker-checker for one request. Returns `{ proceed: true }` only when a
 * DIFFERENT admin had a valid pending request for the same entity + action.
 */
export async function enforceDualControl(input: DualControlInput): Promise<DualControlDecision> {
  const ttl = input.ttlMs ?? DEFAULT_TTL_MS;
  const marker = pendingAction(input.scope, input.action);
  const cutoff = new Date(Date.now() - ttl);

  const pending = await prisma.auditLog.findFirst({
    where: {
      action: marker,
      entity: input.entity,
      entityId: input.entityId,
      createdAt: { gte: cutoff },
    },
    orderBy: { createdAt: "desc" },
  });

  if (pending) {
    if (pending.userId === input.actorId) {
      return {
        proceed: false,
        status: "ALREADY_REQUESTED_BY_YOU",
        message:
          "You already requested this. A different admin must approve it (dual control).",
      };
    }
    // A different admin had a valid pending request → consume it and proceed.
    await prisma.auditLog.delete({ where: { id: pending.id } }).catch(() => {});
    await prisma.auditLog.create({
      data: {
        userId: input.actorId,
        action: `dualctl.${input.scope}.${input.action}.approved`,
        entity: input.entity,
        entityId: input.entityId,
        meta: {
          ...(input.meta ?? {}),
          makerId: pending.userId,
          checkerId: input.actorId,
          approvedAt: new Date().toISOString(),
        },
      },
    });
    return { proceed: true, makerId: pending.userId ?? undefined };
  }

  // No valid pending request → this admin becomes the maker; do NOT execute.
  await prisma.auditLog.create({
    data: {
      userId: input.actorId,
      action: marker,
      entity: input.entity,
      entityId: input.entityId,
      meta: { ...(input.meta ?? {}), makerId: input.actorId, requestedAt: new Date().toISOString() },
    },
  });
  return {
    proceed: false,
    status: "AWAITING_SECOND_APPROVER",
    message:
      "Recorded. A second, different admin must approve this action before it executes (dual control).",
  };
}
