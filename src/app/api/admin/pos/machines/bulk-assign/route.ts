import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, AuthError } from "@/lib/auth-server";
import { isAdminRole, assertCanAccessUser } from "@/lib/security/ownership";
import { enforceRateLimit, RATE_LIMITS, RateLimitError } from "@/lib/security/rateLimit";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import { flags } from "@/lib/env";
import { applyAssignment } from "@/lib/pos/assignments";
import { dec } from "@/lib/money";
import type { Prisma } from "@prisma/client";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const MAX_BULK = 100;

const BulkBody = z
  .object({
    machineIds: z.array(z.string().min(1)).min(1, "Select at least one machine"),
    userId: z.string().min(1).nullable().default(null),
    note: z.string().max(500).optional(),
    returnReason: z.string().max(300).optional(),
    // Subscription params — applied to every assigned machine in the batch.
    subscription: z.object({
      planId: z.string().min(1),
      monthlyRent: z.number().nonnegative(),
      includeGst: z.boolean().default(false),
      billingDay: z.number().int().min(1).max(28).default(1),
    }).optional(),
  })
  .strict();

// A machine may be assigned to any network-tier user (see assign/route.ts).
const ASSIGNABLE_ROLES = new Set([
  "RETAILER",
  "DISTRIBUTOR",
  "MASTER_DISTRIBUTOR",
  "SUPER_DISTRIBUTOR",
]);

/**
 * POST /api/admin/pos/machines/bulk-assign
 *
 * Assign up to 100 machines to one platform user in a single request, or
 * recall (unassign) them when userId is null. Each machine is processed
 * independently. When a subscription block is provided, a rental subscription
 * is auto-created for each successfully assigned machine.
 */
export async function POST(req: Request) {
  let admin;
  try {
    admin = await requireRole("MASTER_ADMIN", "ADMIN");
    if (!isAdminRole(admin.role))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    await enforceRateLimit(`pos:bulk-assign:${admin.id}`, RATE_LIMITS.default);
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
    return NextResponse.json({ error: "POS service is not enabled" }, { status: 503 });

  const parsed = BulkBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { userId, note, returnReason, subscription } = parsed.data;

  const machineIds = Array.from(new Set(parsed.data.machineIds));
  if (machineIds.length > MAX_BULK)
    return NextResponse.json(
      { error: `At most ${MAX_BULK} machines per request` },
      { status: 400 }
    );

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
        { error: "Cannot assign machines to a closed account" },
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

  // Validate plan upfront when subscription is requested.
  if (subscription) {
    const plan = await prisma.posRentalPlan.findFirst({
      where: { id: subscription.planId, active: true },
    });
    if (!plan)
      return NextResponse.json({ error: "Rental plan not found or inactive" }, { status: 404 });
  }

  const machines = await prisma.posMachine.findMany({
    where: { id: { in: machineIds } },
    select: { id: true, tid: true, serial: true, externalId: true, assignedUserId: true },
  });
  const byId = new Map(machines.map((m) => [m.id, m]));

  const succeeded: Array<{ id: string; label: string }> = [];
  const failed: Array<{ id: string; label: string; error: string }> = [];

  for (const id of machineIds) {
    const machine = byId.get(id);
    const label = machine?.tid ?? machine?.serial ?? machine?.externalId ?? id;
    if (!machine) {
      failed.push({ id, label, error: "Machine not found" });
      continue;
    }
    if (machine.assignedUserId === userId) {
      failed.push({
        id,
        label,
        error: userId ? "Already assigned to this user" : "Already unassigned",
      });
      continue;
    }
    try {
      await prisma.$transaction(async (tx) => {
        await applyAssignment(tx, {
          machineId: id,
          fromUserId: machine.assignedUserId,
          toUserId: userId,
          byUserId: admin.id,
          note: note ?? (userId ? "Bulk assigned" : "Bulk recalled"),
          returnReason,
        });

        // Cancel existing subscriptions when unassigning or reassigning.
        if (machine.assignedUserId) {
          await tx.posSubscription.updateMany({
            where: { machineId: id, status: "ACTIVE" },
            data: { status: "CANCELLED", cancelledAt: new Date() },
          });
        }

        // Auto-create subscription for each assigned machine.
        if (userId && subscription) {
          await tx.posSubscription.create({
            data: {
              machineId: id,
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
      });
      succeeded.push({ id, label });
    } catch {
      failed.push({ id, label, error: "Assignment failed" });
    }
  }

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: userId ? "pos.machine.bulk_assign" : "pos.machine.bulk_recall",
      entity: "PosMachine",
      meta: {
        toUserId: userId,
        by: admin.email,
        note: note ?? null,
        returnReason: returnReason ?? null,
        subscription: subscription ?? null,
        requested: machineIds.length,
        succeeded: succeeded.length,
        failed: failed.length,
      } as Prisma.InputJsonValue,
      ip: clientIp(req),
    },
  });

  return NextResponse.json({
    ok: failed.length === 0,
    total: machineIds.length,
    succeededCount: succeeded.length,
    failedCount: failed.length,
    succeeded,
    failed,
  });
}
