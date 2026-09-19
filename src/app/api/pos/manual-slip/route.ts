import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { flags } from "@/lib/env";
import { toNumber } from "@/lib/money";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { assertServiceEnabled } from "@/lib/services/guard";
import { SERVICE_KEYS } from "@/lib/services/catalog";
import { MANUAL_SLIP_FORMATS } from "@/lib/pos/manualSlip";
import { cloudinary } from "@/lib/cloudinary";

/**
 * Retailer — manual POS slip submissions (Yes Bank & other no-API terminals).
 *
 * POST — file a slip for a terminal ASSIGNED to the caller: TID + amount + RRN +
 *        auth code (+ optional card details) and a privately-uploaded slip
 *        (jpg/jpeg/png/pdf). No money exists yet — an admin must approve it
 *        first (see /api/admin/pos/manual-slips). Nothing shows in POS Fleet
 *        until then.
 * GET  — the caller's own slips, newest first, with status + rejection reason so
 *        a rejected slip can be re-uploaded.
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const Body = z
  .object({
    machineId: z.string().min(1, "Select a terminal"),
    grossAmount: z.number().positive("Enter the slip amount").max(10_000_000),
    paymentMode: z.enum(["CARD", "UPI", "NFC", "BHARATQR"]).default("CARD"),
    // Retailer's settlement timing choice for this slip (honored at approval).
    settlementPref: z.enum(["INSTANT", "T1"]).default("T1"),
    // RRN is REQUIRED: it is the per-swipe dedup key. Without it two slips for
    // the SAME physical swipe can't be de-duplicated (the soft check + the
    // partial-unique (tid,rrn) index both key on RRN), which would allow a
    // double approval to double-credit one swipe. Every physical POS slip
    // prints an RRN / Retrieval Reference Number.
    rrn: z.string().trim().min(1, "The slip's RR Number (RRN) is required").max(40),
    authCode: z.string().trim().max(20).optional(),
    cardType: z.enum(["CREDIT", "DEBIT", "PREPAID"]).optional(),
    brandType: z.string().trim().max(20).optional(),
    txnTime: z.string().datetime().optional(),
    slipPublicId: z.string().min(4),
    slipFormat: z.string().trim().max(10).optional(),
    slipResourceType: z.enum(["image", "raw"]).default("image"),
  })
  .strict();

export async function GET() {
  let user;
  try {
    user = await requireAuth();
  } catch (e) {
    return toErrorResponse(e);
  }

  const slips = await prisma.posManualSlip.findMany({
    where: { uploaderUserId: user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json({
    slips: slips.map((s) => ({
      id: s.id,
      tid: s.tid,
      grossAmount: toNumber(s.grossAmount),
      paymentMode: s.paymentMode,
      settlementPref: s.settlementPref,
      rrn: s.rrn,
      authCode: s.authCode,
      status: s.status,
      rejectionReason:
        s.status === "REJECTED" || s.status === "REVERSED" ? s.rejectionReason : null,
      transactionRef: s.transactionRef,
      txnTime: s.txnTime?.toISOString() ?? null,
      reviewedAt: s.reviewedAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
    })),
  });
}

export async function POST(req: Request) {
  let user;
  try {
    user = await requireAuth();
    await assertServiceEnabled(SERVICE_KEYS.POS, { name: "POS Terminals", userId: user.id, role: user.role });
    await enforceRateLimit(`pos:manual-slip:${user.id}`, RATE_LIMITS.fundRequestCreate);
  } catch (e) {
    return toErrorResponse(e);
  }

  if (!flags.pos)
    return NextResponse.json({ error: "POS service is not enabled" }, { status: 503 });

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const d = parsed.data;

  // Reject a future-dated swipe time — the slip records a swipe that already
  // happened; a future date would also mis-place the T+1 settlement day. Allow
  // a small (5 min) skew for client/server clock drift.
  if (d.txnTime && new Date(d.txnTime).getTime() > Date.now() + 5 * 60 * 1000)
    return NextResponse.json({ error: "Transaction time can't be in the future" }, { status: 400 });

  // Slip file must live in THIS user's private folder — blocks referencing any
  // other user's / arbitrary Cloudinary asset (the id is client-reported).
  if (!d.slipPublicId.startsWith(`paybridgex/private/${user.id}/`))
    return NextResponse.json({ error: "Invalid slip upload reference" }, { status: 400 });

  if (d.slipFormat && !MANUAL_SLIP_FORMATS.includes(d.slipFormat.toLowerCase() as never))
    return NextResponse.json(
      { error: "Slip must be a JPG, JPEG, PNG or PDF file" },
      { status: 400 }
    );

  // Best-effort: confirm the private asset actually exists in Cloudinary so a
  // fabricated (but correctly-prefixed) public_id can't be filed as evidence.
  // Only a definitive 404 rejects — a transient Cloudinary error must NOT block
  // a legitimate submission (availability over strictness).
  try {
    await cloudinary.api.resource(d.slipPublicId, {
      type: "private",
      resource_type: d.slipResourceType,
    });
  } catch (e) {
    if ((e as { http_code?: number })?.http_code === 404)
      return NextResponse.json(
        { error: "Slip upload not found — please re-upload the file and try again." },
        { status: 400 }
      );
    // Non-404 (network/rate-limit/etc.): fall through and accept the submission.
  }

  // The terminal must currently be ASSIGNED to the caller (TID matched) and
  // active — this is the gate that lets a retailer submit only for their own
  // machines.
  const machine = await prisma.posMachine.findUnique({
    where: { id: d.machineId },
    select: { id: true, tid: true, assignedUserId: true, status: true, provider: true },
  });
  if (!machine || machine.assignedUserId !== user.id)
    return NextResponse.json(
      { error: "That terminal is not assigned to your account" },
      { status: 403 }
    );
  if (!machine.tid)
    return NextResponse.json({ error: "This terminal has no TID configured yet" }, { status: 400 });
  if (machine.status !== "active")
    return NextResponse.json({ error: "This terminal is not active" }, { status: 400 });
  // API-fed terminals (Same Day) settle automatically from the live feed — a
  // manual slip would double-count. Manual slips are only for no-API acquirers.
  if ((machine.provider ?? "").toUpperCase() === "SAMEDAY")
    return NextResponse.json(
      { error: "This terminal settles automatically — manual slips aren't needed for it." },
      { status: 400 }
    );

  // Soft duplicate guard: block re-submitting the same RRN for the same TID
  // while an earlier one is still pending or already approved. (RRN is required,
  // so this always runs; the partial-unique (tid,rrn) index is the race-proof
  // backstop below.)
  const dup = await prisma.posManualSlip.findFirst({
    where: { tid: machine.tid, rrn: d.rrn, status: { in: ["PENDING", "APPROVED"] } },
    select: { id: true, status: true },
  });
  if (dup)
    return NextResponse.json(
      { error: `A slip with this RRN for TID ${machine.tid} is already ${dup.status.toLowerCase()}.` },
      { status: 409 }
    );

  let slip;
  try {
    slip = await prisma.posManualSlip.create({
      data: {
        uploaderUserId: user.id,
        machineId: machine.id,
        tid: machine.tid,
        grossAmount: d.grossAmount,
        paymentMode: d.paymentMode,
        settlementPref: d.settlementPref,
        rrn: d.rrn,
        authCode: d.authCode || null,
        cardType: d.cardType ?? null,
        brandType: d.brandType || null,
        txnTime: d.txnTime ? new Date(d.txnTime) : null,
        slipPublicId: d.slipPublicId,
        slipFormat: d.slipFormat?.toLowerCase() || null,
        slipResourceType: d.slipResourceType,
        status: "PENDING",
      },
    });
  } catch (e) {
    // Partial unique index (tid, rrn) WHERE status IN (PENDING, APPROVED) —
    // catches the concurrent-duplicate race the soft check above can't.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return NextResponse.json(
        { error: `A slip with this RRN for TID ${machine.tid} is already pending or approved.` },
        { status: 409 }
      );
    throw e;
  }

  return NextResponse.json(
    {
      slip: {
        id: slip.id,
        tid: slip.tid,
        grossAmount: toNumber(slip.grossAmount),
        status: slip.status,
        createdAt: slip.createdAt.toISOString(),
      },
    },
    { status: 201 }
  );
}
