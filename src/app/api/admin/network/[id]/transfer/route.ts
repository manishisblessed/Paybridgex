import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import { getDescendantIds } from "@/lib/security/ownership";
import { NETWORK_TIERS, getParentRole } from "@/lib/hierarchy";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const TRANSFER_EXPIRY_DAYS = 7;

const PostBody = z.object({
  newParentId: z.string().min(1, "New parent is required"),
  reason: z.string().max(500).optional(),
  // "declaration" (default) — the legacy two-step flow where the NEW parent must
  // approve a signed declaration before the reassignment takes effect.
  // "direct" — master-admin reassigns the parent immediately (no approval step);
  // records the change (old/new parent, reason, actor, timestamp) and resets the
  // user's scheme to the platform default. Retailer ID, wallet and transaction
  // history are untouched (only User.parentId + schemeId change).
  mode: z.enum(["declaration", "direct"]).default("declaration"),
});

/**
 * POST — Master Admin initiates a hierarchy transfer (parent reassignment).
 * The new parent must subsequently approve via declaration before the transfer
 * takes effect.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let admin;
  try {
    admin = await requireRole("MASTER_ADMIN");
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const { id: userId } = await params;

  const parsed = PostBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { newParentId, reason, mode } = parsed.data;

  const target = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, role: true, name: true, parentId: true, status: true },
  });
  if (!target)
    return NextResponse.json({ error: "User not found" }, { status: 404 });

  if (!NETWORK_TIERS.includes(target.role as any))
    return NextResponse.json(
      { error: "Only network-tier users can be transferred" },
      { status: 400 }
    );

  if (!target.parentId)
    return NextResponse.json(
      { error: "User has no current parent — cannot transfer top-level users this way" },
      { status: 400 }
    );

  if (target.parentId === newParentId)
    return NextResponse.json(
      { error: "New parent is the same as current parent" },
      { status: 400 }
    );

  const requiredParentRole = getParentRole(target.role);
  if (!requiredParentRole)
    return NextResponse.json(
      { error: "This role cannot have a parent in the hierarchy" },
      { status: 400 }
    );

  const newParent = await prisma.user.findFirst({
    where: { id: newParentId, deletedAt: null },
    select: { id: true, role: true, name: true, status: true },
  });
  if (!newParent)
    return NextResponse.json({ error: "New parent not found" }, { status: 404 });

  if (newParent.role !== requiredParentRole)
    return NextResponse.json(
      {
        error: `New parent must be a ${requiredParentRole.replace(/_/g, " ")} for this ${target.role.replace(/_/g, " ")}`,
      },
      { status: 400 }
    );

  if (newParent.status !== "ACTIVE")
    return NextResponse.json(
      { error: "New parent must be an active user" },
      { status: 400 }
    );

  // Prevent circular hierarchy — new parent must not be in target's downline
  const descendants = await getDescendantIds(target.id);
  if (descendants.includes(newParentId))
    return NextResponse.json(
      { error: "Cannot transfer under a user who is already in this user's downline (circular hierarchy)" },
      { status: 400 }
    );

  // ── Direct mode ─────────────────────────────────────────────────────────
  // Master-admin reassigns the parent immediately. No new-parent declaration.
  // We record an APPROVED HierarchyTransfer (old parent, new parent, reason,
  // initiator, timestamp) as the audit-grade change record, reset the user's
  // scheme to the platform default, and leave everything else (id, wallet,
  // ledger, transactions) untouched.
  if (mode === "direct") {
    if (!reason || reason.trim().length < 3)
      return NextResponse.json(
        { error: "A change reason is required (min 3 characters)" },
        { status: 400 }
      );

    const now = new Date();
    const oldParentId = target.parentId;

    const transfer = await prisma.$transaction(async (tx) => {
      // Supersede any dangling declaration-based transfer for this user so we
      // don't leave an approvable request pointing at a stale parent.
      await tx.hierarchyTransfer.updateMany({
        where: { userId: target.id, status: "PENDING_DECLARATION" },
        data: {
          status: "CANCELLED",
          rejectedAt: now,
          rejectedReason: "Superseded by a direct admin reassignment",
        },
      });

      await tx.user.update({
        where: { id: target.id },
        // schemeId: null → the scheme resolver falls back to the platform
        // default scheme (the old parent's scheme no longer applies).
        data: { parentId: newParentId, schemeId: null },
      });

      const created = await tx.hierarchyTransfer.create({
        data: {
          userId: target.id,
          oldParentId,
          newParentId,
          initiatedById: admin.id,
          reason: reason.trim(),
          status: "APPROVED",
          approvedAt: now,
          // expiresAt is required by the model; for an already-approved direct
          // change it is immaterial, so we pin it to the change time.
          expiresAt: now,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: admin.id,
          action: "hierarchy.transfer_direct",
          entity: "HierarchyTransfer",
          entityId: created.id,
          ip: clientIp(req),
          meta: {
            targetUserId: target.id,
            targetName: target.name,
            targetRole: target.role,
            oldParentId,
            newParentId,
            newParentName: newParent.name,
            reason: reason.trim(),
            schemeReset: true,
          },
        },
      });

      return created;
    });

    // Best-effort notifications — the reassignment is already persisted.
    try {
      await prisma.notification.createMany({
        data: [
          {
            userId: newParentId,
            title: "New member added to your network",
            body: `${target.name} (${target.role.replace(/_/g, " ")}) has been moved under your account by the admin.`,
            channel: "INAPP",
          },
          {
            userId: target.id,
            title: "Your distributor has changed",
            body: `Your account is now managed by ${newParent.name}. Your ID, wallet and history are unchanged; your scheme has been reset to the platform default.`,
            channel: "INAPP",
          },
          ...(oldParentId
            ? [
                {
                  userId: oldParentId,
                  title: "A member left your network",
                  body: `${target.name} (${target.role.replace(/_/g, " ")}) has been reassigned to another ${target.role === "RETAILER" ? "distributor" : "parent"} by the admin.`,
                  channel: "INAPP" as const,
                },
              ]
            : []),
        ],
      });
    } catch {}

    return NextResponse.json({
      ok: true,
      mode: "direct",
      transfer: {
        id: transfer.id,
        status: transfer.status,
        approvedAt: transfer.approvedAt?.toISOString() ?? null,
        oldParentId,
        newParent: { id: newParent.id, name: newParent.name, role: newParent.role },
      },
    });
  }

  // Check for existing pending transfer
  const existing = await prisma.hierarchyTransfer.findFirst({
    where: { userId: target.id, status: "PENDING_DECLARATION" },
  });
  if (existing)
    return NextResponse.json(
      { error: "A transfer is already pending for this user. Cancel it first or wait for it to expire." },
      { status: 409 }
    );

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + TRANSFER_EXPIRY_DAYS);

  const transfer = await prisma.hierarchyTransfer.create({
    data: {
      userId: target.id,
      oldParentId: target.parentId,
      newParentId,
      initiatedById: admin.id,
      reason,
      expiresAt,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: "hierarchy.transfer_initiated",
      entity: "HierarchyTransfer",
      entityId: transfer.id,
      ip: clientIp(req),
      meta: {
        targetUserId: target.id,
        targetName: target.name,
        targetRole: target.role,
        oldParentId: target.parentId,
        newParentId,
        newParentName: newParent.name,
        reason,
      },
    },
  });

  // Notify the new parent
  try {
    await prisma.notification.create({
      data: {
        userId: newParentId,
        title: "Hierarchy Transfer Request",
        body: `Master Admin has requested to transfer ${target.name} (${target.role.replace(/_/g, " ")}) under your account. Please review and approve the declaration.`,
        channel: "INAPP",
      },
    });
  } catch {}

  return NextResponse.json({
    ok: true,
    transfer: {
      id: transfer.id,
      status: transfer.status,
      expiresAt: transfer.expiresAt.toISOString(),
      newParent: { id: newParent.id, name: newParent.name, role: newParent.role },
    },
  });
}

/**
 * GET — List hierarchy transfers for a user (history + pending).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireRole("MASTER_ADMIN", "ADMIN");
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const { id: userId } = await params;

  const transfers = await prisma.hierarchyTransfer.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      reason: true,
      oldParent: { select: { id: true, name: true, role: true } },
      newParent: { select: { id: true, name: true, role: true } },
      initiatedBy: { select: { id: true, name: true } },
      approvedAt: true,
      rejectedAt: true,
      rejectedReason: true,
      expiresAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ transfers });
}
