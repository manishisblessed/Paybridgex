import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireRole } from "@/lib/auth-server";
import { requireAdminActivity } from "@/lib/security/adminActivity";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import { flags } from "@/lib/env";
import { dec, toNumber } from "@/lib/money";
import { creditWallet, LedgerError } from "@/lib/ledger";
import { applyAssignment } from "@/lib/pos/assignments";
import { computeRentalAmounts, istPeriodKey } from "@/lib/pos/rental";
import {
  bookingSelect,
  serializeBooking,
  BOOKING_STATUS_LABEL,
} from "@/lib/pos/booking";
import type { PosBookingStatus } from "@prisma/client";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const ADMIN_ROLES = ["MASTER_ADMIN", "ADMIN", "SUPPORT"] as const;
const PAGE_SIZE = 25;

const notify = async (userId: string, title: string, body: string) => {
  try {
    await prisma.notification.create({
      data: { userId, title, body, channel: "INAPP", href: "/dashboard/pos-booking" },
    });
  } catch {}
};

/**
 * GET /api/admin/pos/booking
 *
 * The ops fulfilment queue: every booking (optionally filtered by status),
 * status counts for the tab badges, and the pool of unassigned machines ops can
 * allocate from.
 */
export async function GET(req: Request) {
  try {
    await requireRole(...ADMIN_ROLES);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  if (!flags.pos)
    return NextResponse.json({ error: "POS service is not enabled" }, { status: 503 });

  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status");
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const exportAll = url.searchParams.get("all") === "1";
  const status = (["APPLIED", "ASSIGNED", "DISPATCHED", "DELIVERED", "CANCELLED"] as string[]).includes(
    statusParam ?? "",
  )
    ? (statusParam as PosBookingStatus)
    : null;

  const where = status ? { status } : {};

  // Full export path: return every matching booking (capped) for CSV download,
  // skipping the counts/machines payload the queue view needs.
  if (exportAll) {
    const rows = await prisma.posBookingRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 5000,
      select: bookingSelect,
    });
    return NextResponse.json({ bookings: rows.map(serializeBooking), total: rows.length });
  }

  const [bookings, total, grouped, machines] = await Promise.all([
    prisma.posBookingRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: bookingSelect,
    }),
    prisma.posBookingRequest.count({ where }),
    prisma.posBookingRequest.groupBy({ by: ["status"], _count: { _all: true } }),
    // Unassigned, active machines ops can allocate. Capped for the picker.
    prisma.posMachine.findMany({
      where: { assignedUserId: null, status: "active" },
      orderBy: { syncedAt: "desc" },
      take: 300,
      select: { id: true, tid: true, serial: true, model: true, provider: true },
    }),
  ]);

  const counts: Record<string, number> = {};
  for (const g of grouped) counts[g.status] = g._count._all;

  return NextResponse.json({
    bookings: bookings.map(serializeBooking),
    total,
    page,
    pageSize: PAGE_SIZE,
    counts,
    machines: machines.map((m) => ({
      id: m.id,
      tid: m.tid,
      serial: m.serial,
      model: m.model,
      provider: m.provider,
    })),
  });
}

const AssignBody = z.object({
  action: z.literal("assign"),
  bookingId: z.string().min(1),
  machineId: z.string().min(1),
  note: z.string().max(500).optional(),
});
const DispatchBody = z.object({
  action: z.literal("dispatch"),
  bookingId: z.string().min(1),
  courier: z.string().trim().max(120).optional(),
  trackingRef: z.string().trim().max(120).optional(),
});
const DeliverBody = z.object({
  action: z.literal("deliver"),
  bookingId: z.string().min(1),
  note: z.string().max(500).optional(),
});
const CancelBody = z.object({
  action: z.literal("cancel"),
  bookingId: z.string().min(1),
  reason: z.string().trim().min(3, "Give a short cancellation reason").max(500),
});
const Body = z.discriminatedUnion("action", [AssignBody, DispatchBody, DeliverBody, CancelBody]);

/**
 * POST /api/admin/pos/booking
 *
 * Drives the fulfilment lifecycle:
 *   assign   → allocate a machine (creates the PosSubscription; the first
 *              billing cycle is pre-paid at booking so a PAID invoice is
 *              stamped for the current period to keep the billing engine idle
 *              until next cycle)
 *   dispatch → mark handed to courier (+ tracking)
 *   deliver  → mark received — fulfilment complete
 *   cancel   → cancel/reject and refund the upfront charge; any allocated
 *              machine is returned to stock and its subscription cancelled
 */
export async function POST(req: Request) {
  const raw = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(raw);
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const data = parsed.data;

  let admin;
  try {
    admin = await requireAdminActivity(req, {
      action: `pos.booking.${data.action}`,
      roles: ADMIN_ROLES,
      entity: "PosBookingRequest",
      entityId: data.bookingId,
      body: raw,
    });
    await enforceRateLimit(`pos:booking:admin:${admin.id}`, RATE_LIMITS.default);
  } catch (e) {
    return toErrorResponse(e);
  }

  if (!flags.pos)
    return NextResponse.json({ error: "POS service is not enabled" }, { status: 503 });

  const booking = await prisma.posBookingRequest.findUnique({
    where: { id: data.bookingId },
    select: {
      id: true, userId: true, planId: true, status: true, machineId: true,
      subscriptionId: true, monthlyRent: true, includeGst: true, billingDay: true,
      amountPaid: true, refundTxnId: true,
      plan: { select: { name: true } },
    },
  });
  if (!booking)
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  // ── ASSIGN ──────────────────────────────────────────────────────────────
  if (data.action === "assign") {
    if (booking.status !== "APPLIED")
      return NextResponse.json({ error: `Cannot assign a booking that is ${BOOKING_STATUS_LABEL[booking.status]}` }, { status: 409 });

    const machine = await prisma.posMachine.findUnique({
      where: { id: data.machineId },
      select: { id: true, tid: true, serial: true, assignedUserId: true, status: true },
    });
    if (!machine)
      return NextResponse.json({ error: "Machine not found" }, { status: 404 });
    if (machine.assignedUserId)
      return NextResponse.json({ error: "That machine is already assigned to someone else" }, { status: 409 });

    const periodKey = istPeriodKey();
    const { rent, gst, total } = computeRentalAmounts(booking.monthlyRent.toString(), booking.includeGst);

    const updated = await prisma.$transaction(async (tx) => {
      // Move the machine to the applicant.
      await applyAssignment(tx, {
        machineId: machine.id,
        fromUserId: null,
        toUserId: booking.userId,
        byUserId: admin.id,
        note: data.note ?? `Allocated via booking ${booking.id}`,
      });

      // Create the ongoing rental subscription so monthly billing takes over.
      const sub = await tx.posSubscription.create({
        data: {
          machineId: machine.id,
          userId: booking.userId,
          planId: booking.planId,
          billingDay: booking.billingDay,
          monthlyRent: dec(booking.monthlyRent),
          includeGst: booking.includeGst,
          commission: dec(0),
          createdById: admin.id,
          status: "ACTIVE",
        },
      });

      // The first month's rent was pre-paid at booking — stamp a PAID invoice
      // for the current period so the billing engine skips it and only charges
      // from the next cycle onward.
      if (total.gt(0)) {
        await tx.posRentalInvoice.create({
          data: {
            subscriptionId: sub.id,
            periodKey,
            amount: rent,
            gstAmount: gst,
            totalAmount: total,
            commissionAmount: dec(0),
            status: "PAID",
            detail: `Prepaid at booking (${booking.id})`,
          },
        });
      }

      await tx.posBookingEvent.create({
        data: {
          bookingId: booking.id,
          status: "ASSIGNED",
          byUserId: admin.id,
          note: `Machine ${machine.tid ?? machine.serial ?? machine.id.slice(0, 8)} allocated`,
        },
      });

      return tx.posBookingRequest.update({
        where: { id: booking.id },
        data: {
          status: "ASSIGNED",
          machineId: machine.id,
          subscriptionId: sub.id,
          assignedById: admin.id,
          assignedAt: new Date(),
        },
        select: bookingSelect,
      });
    });

    await notify(
      booking.userId,
      "POS machine assigned",
      `Good news! A machine (${machine.tid ?? machine.serial ?? "your terminal"}) has been assigned to your ${booking.plan.name} booking. It will be dispatched soon.`,
    );

    return NextResponse.json({ ok: true, booking: serializeBooking(updated) });
  }

  // ── DISPATCH ────────────────────────────────────────────────────────────
  if (data.action === "dispatch") {
    if (booking.status !== "ASSIGNED")
      return NextResponse.json({ error: `Can only dispatch an assigned booking (currently ${BOOKING_STATUS_LABEL[booking.status]})` }, { status: 409 });

    const trackNote = [data.courier, data.trackingRef].filter(Boolean).join(" · ");
    const updated = await prisma.$transaction(async (tx) => {
      await tx.posBookingEvent.create({
        data: {
          bookingId: booking.id,
          status: "DISPATCHED",
          byUserId: admin.id,
          note: trackNote || "Handed to courier",
        },
      });
      return tx.posBookingRequest.update({
        where: { id: booking.id },
        data: {
          status: "DISPATCHED",
          dispatchedAt: new Date(),
          courier: data.courier || null,
          trackingRef: data.trackingRef || null,
        },
        select: bookingSelect,
      });
    });

    await notify(
      booking.userId,
      "POS machine dispatched",
      `Your ${booking.plan.name} machine is on its way!${trackNote ? ` (${trackNote})` : ""} Track delivery under POS Booking.`,
    );

    return NextResponse.json({ ok: true, booking: serializeBooking(updated) });
  }

  // ── DELIVER ─────────────────────────────────────────────────────────────
  if (data.action === "deliver") {
    if (booking.status !== "DISPATCHED")
      return NextResponse.json({ error: `Can only mark a dispatched booking as delivered (currently ${BOOKING_STATUS_LABEL[booking.status]})` }, { status: 409 });

    const updated = await prisma.$transaction(async (tx) => {
      await tx.posBookingEvent.create({
        data: {
          bookingId: booking.id,
          status: "DELIVERED",
          byUserId: admin.id,
          note: data.note || "Delivered to applicant",
        },
      });
      return tx.posBookingRequest.update({
        where: { id: booking.id },
        data: { status: "DELIVERED", deliveredAt: new Date() },
        select: bookingSelect,
      });
    });

    await notify(
      booking.userId,
      "POS machine delivered",
      `Your ${booking.plan.name} machine has been delivered. You're all set to start accepting payments!`,
    );

    return NextResponse.json({ ok: true, booking: serializeBooking(updated) });
  }

  // ── CANCEL (+ refund) ─────────────────────────────────────────────────────
  if (data.action === "cancel") {
    if (booking.status === "DELIVERED" || booking.status === "CANCELLED")
      return NextResponse.json({ error: `Cannot cancel a booking that is ${BOOKING_STATUS_LABEL[booking.status]}` }, { status: 409 });

    const refundAmount = dec(booking.amountPaid);

    try {
      const updated = await prisma.$transaction(async (tx) => {
        // Return any allocated machine to stock + cancel its subscription.
        if (booking.machineId) {
          await applyAssignment(tx, {
            machineId: booking.machineId,
            fromUserId: booking.userId,
            toUserId: null,
            byUserId: admin.id,
            returnReason: `Booking cancelled: ${data.reason}`,
          });
          if (booking.subscriptionId) {
            await tx.posSubscription.updateMany({
              where: { id: booking.subscriptionId, status: "ACTIVE" },
              data: { status: "CANCELLED", cancelledAt: new Date() },
            });
          }
        }

        // Refund the upfront charge (idempotent per booking).
        let refundTxnId: string | null = booking.refundTxnId;
        if (!refundTxnId && refundAmount.gt(0)) {
          const refund = await creditWallet(
            {
              userId: booking.userId,
              amount: refundAmount,
              reason: "REVERSAL",
              refType: "PosBookingRequest",
              refId: booking.id,
              note: `POS booking cancelled — refund of ₹${toNumber(refundAmount)} (${booking.plan.name})`,
              idempotencyKey: `pos-booking-refund:${booking.id}`,
            },
            tx,
          );
          refundTxnId = refund.id;
        }

        await tx.posBookingEvent.create({
          data: {
            bookingId: booking.id,
            status: "CANCELLED",
            byUserId: admin.id,
            note: `Cancelled: ${data.reason}${refundAmount.gt(0) ? ` — ₹${toNumber(refundAmount)} refunded` : ""}`,
          },
        });

        return tx.posBookingRequest.update({
          where: { id: booking.id },
          data: {
            status: "CANCELLED",
            cancelledAt: new Date(),
            cancelReason: data.reason,
            refundTxnId,
          },
          select: bookingSelect,
        });
      });

      await notify(
        booking.userId,
        "POS booking cancelled",
        `Your ${booking.plan.name} booking was cancelled.${refundAmount.gt(0) ? ` ₹${toNumber(refundAmount)} has been refunded to your wallet.` : ""} Reason: ${data.reason}`,
      );

      await prisma.auditLog.create({
        data: {
          userId: admin.id,
          action: "pos.booking.cancel",
          entity: "PosBookingRequest",
          entityId: booking.id,
          meta: { reason: data.reason, refund: toNumber(refundAmount) },
          ip: clientIp(req),
        },
      });

      return NextResponse.json({ ok: true, booking: serializeBooking(updated) });
    } catch (e) {
      if (e instanceof LedgerError)
        return NextResponse.json({ error: `Refund failed: ${e.message}` }, { status: 400 });
      throw e;
    }
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
