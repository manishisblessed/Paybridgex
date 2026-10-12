import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminActivity } from "@/lib/security/adminActivity";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { enforceDualControl } from "@/lib/security/dualControl";
import { resolveOnePayout } from "@/lib/payout/service";
import { prisma } from "@/lib/db";
import { toNumber } from "@/lib/money";

// force_paid / force_failed on a payout at or above this value needs a second,
// different admin to approve (dual control). Env-overridable.
const DUAL_CONTROL_PAYOUT_AMOUNT = Number(process.env.DUAL_CONTROL_PAYOUT_AMOUNT ?? 50_000);

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/payouts/resolve
 *   { payoutId, action: "recover"|"poll"|"force_paid"|"force_failed",
 *     reference?, utr?, note? }
 *
 * Operator resolution of a payout HELD as NEEDS_REVIEW (indeterminate send).
 * The invariant is preserved on every path: the hold is only RELEASED when the
 * bank definitively did NOT disburse.
 *
 *   recover      — auto-recover the rail reference (settlement list) + poll; no
 *                  money moves unless the rail reports a terminal state.
 *   poll         — operator supplies the real rail reference_id (read from the
 *                  Same Day panel), then poll the status API.
 *   force_paid   — operator confirmed the money DID leave (bank statement/UTR):
 *                  capture the hold into a real DEBIT.
 *   force_failed — operator confirmed the money did NOT leave: release the hold.
 *
 * force_* paths move money on the operator's authority, so they are restricted
 * to MASTER_ADMIN and audited.
 */
const Body = z
  .object({
    payoutId: z.string().trim().min(3).max(60),
    action: z.enum(["recover", "poll", "force_paid", "force_failed"]),
    reference: z.string().trim().min(3).max(120).optional(),
    utr: z.string().trim().min(3).max(60).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((b) => b.action !== "poll" || Boolean(b.reference), {
    message: "A rail reference_id is required to poll",
    path: ["reference"],
  });

export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    // force_* captures/releases held funds on the operator's say-so → MASTER only.
    const force = parsed.data.action === "force_paid" || parsed.data.action === "force_failed";
    const admin = await requireAdminActivity(req, {
      action: `payout.resolve.${parsed.data.action}`,
      roles: force ? ["MASTER_ADMIN"] : ["MASTER_ADMIN", "ADMIN"],
      entity: "PayoutRequest",
    });
    await enforceRateLimit(`payout:resolve:${admin.id}`, RATE_LIMITS.sensitiveWrite);

    // Dual control: a large force_paid/force_failed needs a second approver.
    if (force) {
      const payout = await prisma.payoutRequest.findUnique({
        where: { id: parsed.data.payoutId },
        select: { totalDebit: true },
      });
      const amount = toNumber(payout?.totalDebit ?? 0);
      if (amount >= DUAL_CONTROL_PAYOUT_AMOUNT) {
        const decision = await enforceDualControl({
          scope: "payout.force",
          action: parsed.data.action,
          entity: "PayoutRequest",
          entityId: parsed.data.payoutId,
          actorId: admin.id,
          meta: { amount, action: parsed.data.action },
        });
        if (!decision.proceed) {
          return NextResponse.json(
            {
              changed: false,
              dualControl: decision.status,
              message: decision.message,
              threshold: DUAL_CONTROL_PAYOUT_AMOUNT,
              amount,
            },
            { status: 202 }
          );
        }
      }
    }

    const result = await resolveOnePayout(parsed.data.payoutId, {
      actorId: admin.id,
      action: parsed.data.action,
      reference: parsed.data.reference ?? null,
      utr: parsed.data.utr ?? null,
      note: parsed.data.note ?? null,
    });

    return NextResponse.json(result);
  } catch (e) {
    return toErrorResponse(e);
  }
}
