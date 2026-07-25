import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, AuthError } from "@/lib/auth-server";
import { isAdminRole, assertCanAccessUser } from "@/lib/security/ownership";
import { enforceRateLimit, RATE_LIMITS, RateLimitError } from "@/lib/security/rateLimit";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import { flags } from "@/lib/env";
import { applyAssignment, posMachineSelect, serializePosMachine } from "@/lib/pos/assignments";
import { dec } from "@/lib/money";

export const fetchCache = "force-no-store";

export const dynamic = "force-dynamic";

const AssignBody = z.object({
  machineId: z.string().min(1, "machineId is required"),
  userId: z.string().min(1).nullable().default(null),
  note: z.string().max(500).optional(),
  // Subscription fields — when assigning, admin may set a monthly rent.
  // Subscription is auto-created on assignment when provided.
  subscription: z.object({
    planId: z.string().min(1),
    monthlyRent: z.number().nonnegative(),
    includeGst: z.boolean().default(false),
    billingDay: z.number().int().min(1).max(28).default(1),
  }).optional(),
}).strict();

// A machine may be assigned to any network-tier user. When assigned to a
// retailer, the terminal (and its transactions) is visible up the chain to the
// DT/MD/SD, and the assignee's scheme drives MDR + the upline commission split.
const ASSIGNABLE_ROLES = new Set([
  "RETAILER",
  "DISTRIBUTOR",
  "MASTER_DISTRIBUTOR",
  "SUPER_DISTRIBUTOR",
]);

/**
 * POST /api/admin/pos/machines/assign
 *
 * Assign (or unassign when userId is null) a synced POS machine to a platform
 * user. When assigning, an optional subscription block auto-creates a monthly
 * rental subscription with the specified rent and GST preference.
 */
export async function POST(req: Request) {
  let admin;
  try {
    admin = await requireRole("MASTER_ADMIN", "ADMIN");
    if (!isAdminRole(admin.role))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    await enforceRateLimit(`pos:assign:${admin.id}`, RATE_LIMITS.default);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    if (e instanceof RateLimitError)
      return NextResponse.json(
        { error: e.message, retryAfterSec: e.result.retryAfterSec },
        { status: 429 }
      );
    throw e;
  }

  if (!flags.pos)
    return NextResponse.json(
      { error: "POS service is not enabled" },
      { status: 503 }
    );

  const parsed = AssignBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { machineId, userId, note, subscription } = parsed.data;

  const machine = await prisma.posMachine.findUnique({
    where: { id: machineId },
    select: { id: true, assignedUserId: true },
  });
  if (!machine)
    return NextResponse.json({ error: "POS machine not found" }, { status: 404 });

  if (userId) {
    const target = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, role: true, status: true },
    });
    if (!target)
      return NextResponse.json({ error: "Target user not found" }, { status: 404 });
    if (!ASSIGNABLE_ROLES.has(target.role))
      return NextResponse.json(
        { error: "POS machines can only be assigned to network users (Retailer, Distributor, Master-Distributor, Super-Distributor)" },
        { status: 400 }
      );
    if (target.status === "CLOSED")
      return NextResponse.json(
        { error: "Cannot assign a machine to a closed account" },
        { status: 400 }
      );

    try {
      await assertCanAccessUser(userId, admin);
    } catch (e) {
      if (e instanceof AuthError)
        return NextResponse.json({ error: e.message }, { status: e.statusCode });
      throw e;
    }
  }

  const fromUserId = machine.assignedUserId;
  const action = userId ? "assign" : "unassign";

  if (fromUserId === userId) {
    const current = await prisma.posMachine.findUnique({
      where: { id: machineId },
      select: posMachineSelect,
    });
    return NextResponse.json({ ok: true, machine: current && serializePosMachine(current) });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await applyAssignment(tx, {
      machineId,
      fromUserId,
      toUserId: userId,
      byUserId: admin.id,
      note,
    });

    // Cancel any active subscription on this machine when unassigning or reassigning.
    if (fromUserId) {
      await tx.posSubscription.updateMany({
        where: { machineId, status: "ACTIVE" },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
    }

    // Auto-create subscription when assigning with subscription params.
    if (userId && subscription) {
      const plan = await tx.posRentalPlan.findFirst({
        where: { id: subscription.planId, active: true },
      });
      if (!plan) throw new Error("Rental plan not found or inactive");

      await tx.posSubscription.create({
        data: {
          machineId,
          userId,
          planId: subscription.planId,
          billingDay: subscription.billingDay,
          monthlyRent: dec(subscription.monthlyRent),
          includeGst: subscription.includeGst,
          commission: dec(0),
          createdById: admin.id,
          status: "ACTIVE",
        },
      });
    }

    return row;
  });

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: `pos.machine.${action}`,
      entity: "PosMachine",
      entityId: machineId,
      meta: {
        fromUserId,
        toUserId: userId,
        by: admin.email,
        note: note ?? null,
        subscription: subscription ?? null,
      },
      ip: clientIp(req),
    },
  });

  return NextResponse.json({ ok: true, machine: serializePosMachine(updated) });
}
