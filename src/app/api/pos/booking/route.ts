import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS, RateLimitError } from "@/lib/security/rateLimit";
import { clientIp } from "@/lib/security/audit";
import { flags } from "@/lib/env";
import { dec, add, toNumber } from "@/lib/money";
import { computeRentalAmounts } from "@/lib/pos/rental";
import { debitWallet, creditWallet, LedgerError } from "@/lib/ledger";
import { bookingSelect, serializeBooking } from "@/lib/pos/booking";
import { istToday } from "@/lib/utils";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

// Any network-tier user may book a POS machine for themselves. Admin/support
// roles manage the fulfilment queue instead and never book.
const BOOKING_ROLES = new Set([
  "RETAILER",
  "DISTRIBUTOR",
  "MASTER_DISTRIBUTOR",
  "SUPER_DISTRIBUTOR",
]);

const CreateBody = z.object({
  planId: z.string().min(1, "Pick a rental plan"),
  deliveryAddress: z.string().trim().min(10, "Enter a full delivery address (with state, city & pincode)").max(600),
  contactName: z.string().trim().max(120).optional(),
  contactPhone: z.string().trim().max(20).optional(),
  confirm: z.literal(true, { errorMap: () => ({ message: "Please confirm the purchase" }) }),
});

/** Current IST day-of-month, clamped to a safe billing day (1–28). */
function currentBillingDay(): number {
  const day = Number(istToday().slice(8, 10));
  return Math.min(28, Math.max(1, Number.isFinite(day) ? day : 1));
}

/**
 * GET /api/pos/booking
 *
 * Returns the catalogue of bookable (active, platform-owned) rental plans plus
 * the caller's own booking requests with their live fulfilment status.
 */
export async function GET() {
  let user;
  try {
    user = await requireAuth();
    if (!BOOKING_ROLES.has(user.role))
      return NextResponse.json({ error: "Only network users can book POS machines" }, { status: 403 });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  if (!flags.pos)
    return NextResponse.json({ error: "POS service is not enabled" }, { status: 503 });

  const [plans, bookings, dbUser] = await Promise.all([
    prisma.posRentalPlan.findMany({
      where: { active: true, ownerId: null },
      orderBy: { monthlyRent: "asc" },
      select: {
        id: true, name: true, description: true,
        monthlyRent: true, setupFee: true, deposit: true, includeGst: true,
      },
    }),
    prisma.posBookingRequest.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: bookingSelect,
    }),
    prisma.user.findUnique({ where: { id: user.id }, select: { walletBalance: true } }),
  ]);

  return NextResponse.json({
    plans: plans.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      monthlyRent: toNumber(p.monthlyRent),
      setupFee: toNumber(p.setupFee),
      deposit: toNumber(p.deposit),
      includeGst: p.includeGst,
    })),
    bookings: bookings.map(serializeBooking),
    walletBalance: dbUser ? toNumber(dbUser.walletBalance) : 0,
  });
}

/**
 * POST /api/pos/booking
 *
 * Place a booking (steps 1–3): the applicant applies for a machine on a chosen
 * plan, confirms a delivery address, and the upfront charge — one-time setup
 * fee + refundable/non-refundable deposit + the first month's rent (optionally
 * incl. 18% GST) — is debited from their wallet in a single transaction. If the
 * wallet has insufficient balance the whole thing rolls back and nothing is
 * booked. A machine is allocated later by ops (see the admin route).
 */
export async function POST(req: Request) {
  let user;
  try {
    user = await requireAuth();
    if (!BOOKING_ROLES.has(user.role))
      return NextResponse.json({ error: "Only network users can book POS machines" }, { status: 403 });
    await enforceRateLimit(`pos:booking:${user.id}`, RATE_LIMITS.sensitiveWrite);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    if (e instanceof RateLimitError)
      return NextResponse.json({ error: e.message, retryAfterSec: e.result.retryAfterSec }, { status: 429 });
    throw e;
  }

  if (!flags.pos)
    return NextResponse.json({ error: "POS service is not enabled" }, { status: 503 });

  const parsed = CreateBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { planId, deliveryAddress, contactName, contactPhone } = parsed.data;

  const plan = await prisma.posRentalPlan.findFirst({
    where: { id: planId, active: true, ownerId: null },
    select: { id: true, name: true, monthlyRent: true, setupFee: true, deposit: true, includeGst: true },
  });
  if (!plan)
    return NextResponse.json({ error: "Rental plan not found or unavailable" }, { status: 404 });

  // Block stacking a second in-flight booking on the same plan (a delivered or
  // cancelled one may be re-booked). Keeps the fulfilment queue clean.
  const openOnPlan = await prisma.posBookingRequest.findFirst({
    where: { userId: user.id, planId, status: { in: ["APPLIED", "ASSIGNED", "DISPATCHED"] } },
    select: { id: true },
  });
  if (openOnPlan)
    return NextResponse.json(
      { error: "You already have an in-progress booking for this plan. Track it below." },
      { status: 409 },
    );

  const { rent, gst } = computeRentalAmounts(plan.monthlyRent.toString(), plan.includeGst);
  const setupFee = dec(plan.setupFee);
  const deposit = dec(plan.deposit);
  const total = add(add(add(rent, gst), setupFee), deposit);

  if (!total.gt(0))
    return NextResponse.json({ error: "This plan has no payable charge configured" }, { status: 400 });

  const billingDay = currentBillingDay();

  try {
    const booking = await prisma.$transaction(async (tx) => {
      const created = await tx.posBookingRequest.create({
        data: {
          userId: user.id,
          planId: plan.id,
          status: "APPLIED",
          deliveryAddress,
          contactName: contactName || null,
          contactPhone: contactPhone || null,
          monthlyRent: rent,
          includeGst: plan.includeGst,
          gstAmount: gst,
          setupFee,
          deposit,
          amountPaid: total,
          billingDay,
        },
        select: { id: true },
      });

      // Debit the upfront charge inside the same transaction so an insufficient
      // balance rolls the booking back entirely.
      const txn = await debitWallet(
        {
          userId: user.id,
          amount: total,
          reason: "RENTAL",
          refType: "PosBookingRequest",
          refId: created.id,
          note: `POS machine booking · ${plan.name} (rent ${toNumber(rent)}${plan.includeGst ? ` + GST ${toNumber(gst)}` : ""}${toNumber(setupFee) > 0 ? ` + setup ${toNumber(setupFee)}` : ""}${toNumber(deposit) > 0 ? ` + deposit ${toNumber(deposit)}` : ""})`,
          idempotencyKey: `pos-booking:${created.id}`,
        },
        tx,
      );

      await tx.posBookingEvent.create({
        data: {
          bookingId: created.id,
          status: "APPLIED",
          byUserId: user.id,
          note: `Booking placed — ₹${toNumber(total)} charged to wallet`,
        },
      });

      return tx.posBookingRequest.update({
        where: { id: created.id },
        data: { chargeTxnId: txn.id },
        select: bookingSelect,
      });
    });

    // Confirmation for the applicant + a real-time alert to every admin who can
    // fulfil the queue, deep-linked straight to the POS Bookings tab (best-effort).
    try {
      await prisma.notification.create({
        data: {
          userId: user.id,
          title: "POS booking placed",
          body: `Your ${plan.name} booking is confirmed and ₹${toNumber(total)} has been charged. We'll assign & dispatch your machine shortly — track it under POS Booking.`,
          channel: "INAPP",
          href: "/dashboard/pos-booking",
        },
      });

      // Fan out to everyone who can actually work the queue: master-admins &
      // admins always, plus sub-admins (role SUPPORT) granted the "pos-bookings"
      // tab — an empty allowedTabs means they inherit the full admin menu, so
      // those sub-admins have the tab too and are included.
      const admins = await prisma.user.findMany({
        where: {
          deletedAt: null,
          status: { not: "CLOSED" },
          OR: [
            { role: { in: ["MASTER_ADMIN", "ADMIN"] } },
            { role: "SUPPORT", allowedTabs: { has: "pos-bookings" } },
            { role: "SUPPORT", allowedTabs: { isEmpty: true } },
          ],
        },
        select: { id: true },
      });
      if (admins.length > 0) {
        const who = user.name || user.email || "A user";
        await prisma.notification.createMany({
          data: admins.map((a) => ({
            userId: a.id,
            title: "New POS booking request",
            body: `${who} applied for a ${plan.name} POS machine (₹${toNumber(total)} paid). Assign & dispatch it from POS Bookings.`,
            channel: "INAPP",
            href: "/dashboard/admin/pos-bookings",
          })),
        });
      }
    } catch {}

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "pos.booking.create",
        entity: "PosBookingRequest",
        entityId: booking.id,
        meta: { planId: plan.id, planName: plan.name, amountPaid: toNumber(total), billingDay },
        ip: clientIp(req),
      },
    });

    return NextResponse.json({ ok: true, booking: serializeBooking(booking) });
  } catch (e) {
    if (e instanceof LedgerError && e.code === "INSUFFICIENT_FUNDS")
      return NextResponse.json(
        { error: `Insufficient wallet balance. You need ₹${toNumber(total)} to book this machine. Please top up and try again.` },
        { status: 402 },
      );
    if (e instanceof LedgerError)
      return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}

const CancelBody = z.object({
  bookingId: z.string().min(1),
});

/**
 * PATCH /api/pos/booking
 *
 * Applicant self-cancels their own booking — allowed only while it is still
 * APPLIED (no machine allocated yet). The full upfront charge is refunded to
 * their wallet. Once ops has assigned a machine, cancellation must go through
 * the admin console. The refund shares the same idempotency key as the admin
 * refund path, so a booking can never be refunded twice.
 */
export async function PATCH(req: Request) {
  let user;
  try {
    user = await requireAuth();
    if (!BOOKING_ROLES.has(user.role))
      return NextResponse.json({ error: "Only network users can manage bookings" }, { status: 403 });
    await enforceRateLimit(`pos:booking:cancel:${user.id}`, RATE_LIMITS.sensitiveWrite);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    if (e instanceof RateLimitError)
      return NextResponse.json({ error: e.message, retryAfterSec: e.result.retryAfterSec }, { status: 429 });
    throw e;
  }

  if (!flags.pos)
    return NextResponse.json({ error: "POS service is not enabled" }, { status: 503 });

  const parsed = CancelBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const booking = await prisma.posBookingRequest.findFirst({
    where: { id: parsed.data.bookingId, userId: user.id },
    select: { id: true, status: true, amountPaid: true, refundTxnId: true, plan: { select: { name: true } } },
  });
  if (!booking)
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  if (booking.status !== "APPLIED")
    return NextResponse.json(
      { error: "This booking can no longer be self-cancelled — a machine has already been assigned. Please contact support." },
      { status: 409 },
    );

  const refundAmount = dec(booking.amountPaid);

  const updated = await prisma.$transaction(async (tx) => {
    let refundTxnId: string | null = booking.refundTxnId;
    if (!refundTxnId && refundAmount.gt(0)) {
      const refund = await creditWallet(
        {
          userId: user.id,
          amount: refundAmount,
          reason: "REVERSAL",
          refType: "PosBookingRequest",
          refId: booking.id,
          note: `POS booking cancelled by you — refund of ₹${toNumber(refundAmount)} (${booking.plan.name})`,
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
        byUserId: user.id,
        note: `Cancelled by applicant${refundAmount.gt(0) ? ` — ₹${toNumber(refundAmount)} refunded` : ""}`,
      },
    });

    return tx.posBookingRequest.update({
      where: { id: booking.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: "Cancelled by applicant",
        refundTxnId,
      },
      select: bookingSelect,
    });
  });

  try {
    await prisma.notification.create({
      data: {
        userId: user.id,
        title: "POS booking cancelled",
        body: `Your ${booking.plan.name} booking was cancelled${refundAmount.gt(0) ? ` and ₹${toNumber(refundAmount)} refunded to your wallet` : ""}.`,
        channel: "INAPP",
        href: "/dashboard/pos-booking",
      },
    });
  } catch {}

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "pos.booking.self_cancel",
      entity: "PosBookingRequest",
      entityId: booking.id,
      meta: { refund: toNumber(refundAmount) },
      ip: clientIp(req),
    },
  });

  return NextResponse.json({ ok: true, booking: serializeBooking(updated) });
}
