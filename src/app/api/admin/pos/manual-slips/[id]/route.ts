import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminActivity } from "@/lib/security/adminActivity";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { approveManualSlip, rejectManualSlip, reverseManualSlip, ManualSlipError } from "@/lib/pos/manualSlip";

/**
 * POST /api/admin/pos/manual-slips/[id]
 *
 * Approve, reject or reverse a manual POS slip. Any admin may act; no second
 * approval is required. Approve splices the slip into the shared settlement
 * engine (mirror + PENDING settlement entry); reject records a reason shown to
 * the retailer; reverse rolls back an already-approved slip via the shared
 * reversal engine (cancels a pending entry / flags a settled one for clawback).
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reject"), reason: z.string().trim().min(1, "A reason is required").max(500) }),
  z.object({ action: z.literal("reverse"), reason: z.string().trim().min(1, "A reason is required").max(500) }),
]);

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  let admin;
  try {
    admin = await requireAdminActivity(req, {
      action: "pos.manual_slip.review",
      roles: ["MASTER_ADMIN", "ADMIN"],
      entity: "PosManualSlip",
      entityId: params.id,
    });
  } catch (e) {
    return toErrorResponse(e);
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    if (parsed.data.action === "approve") {
      const { slip, capture } = await approveManualSlip(params.id, admin.id);
      return NextResponse.json({
        ok: true,
        status: slip.status,
        transactionRef: slip.transactionRef,
        settlement: {
          status: capture.status,
          mode: capture.mode ?? null,
          netAmount: capture.netAmount ?? null,
          mdrAmount: capture.mdrAmount ?? null,
        },
      });
    }
    if (parsed.data.action === "reverse") {
      const { slip, reversal } = await reverseManualSlip(params.id, admin.id, parsed.data.reason);
      return NextResponse.json({
        ok: true,
        status: slip.status,
        reversal: {
          outcome: reversal.outcome,
          wasSettled: reversal.wasSettled ?? false,
          netAmount: reversal.netAmount ?? null,
        },
      });
    }
    const { slip } = await rejectManualSlip(params.id, admin.id, parsed.data.reason);
    return NextResponse.json({ ok: true, status: slip.status });
  } catch (e) {
    if (e instanceof ManualSlipError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    return toErrorResponse(e);
  }
}
