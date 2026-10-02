import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminActivity } from "@/lib/security/adminActivity";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { correctOneTransaction } from "@/lib/recon/reconcileOne";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/transactions/resolve  { refId, providerRef?, remarks? }
 *
 * CORRECTIVE resolver for the direct-financial-loss case: a bill payment the
 * provider actually COMPLETED but PaybridgeX recorded as FAILED (and
 * auto-refunded) or is HOLDing as NEEDS_REVIEW. Unlike the plain reconcile
 * endpoint, this one can also repair an already-TERMINAL FAILED/REFUNDED row.
 *
 * It NEVER moves money on an admin's say-so: it RE-VERIFIES the outcome against
 * the provider's own status API first. When the pay-step response was lost (so
 * the status API returns ORDER_NOT_FOUND from the surviving bill_fetch_ref), the
 * admin reads the true outcome + pay-step reference from the provider panel and
 * passes it as `providerRef`; the API then confirms SUCCESS using that ref and
 * auto-settles with a LIEN-based clawback of any earlier refund — never driving
 * the wallet negative.
 */
const Body = z
  .object({
    refId: z.string().trim().min(3).max(60),
    /** Pay-step order_id / request_id recovered from the provider panel. */
    providerRef: z.string().trim().min(3).max(120).optional(),
    remarks: z.string().trim().max(500).optional(),
  })
  .strict();

export async function POST(req: Request) {
  try {
    const admin = await requireAdminActivity(req, {
      action: "txn.resolve",
      roles: ["MASTER_ADMIN", "ADMIN"],
      entity: "Transaction",
    });
    await enforceRateLimit(`txn:resolve:${admin.id}`, RATE_LIMITS.sensitiveWrite);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    const result = await correctOneTransaction(parsed.data.refId, {
      actorId: admin.id,
      providerRef: parsed.data.providerRef,
      remarks: parsed.data.remarks,
      source: "admin_resolve",
    });

    if (!result.found)
      return NextResponse.json({ error: "No transaction found for that reference" }, { status: 404 });

    // The provider could not confirm the outcome from any available reference —
    // the admin must supply the pay-step reference from the provider panel.
    if (result.outcome === "unresolved") {
      return NextResponse.json(
        {
          ...result,
          hint:
            "Provider status could not be resolved. Look up the payment in the provider panel and resubmit with `providerRef` set to its pay-step order_id / request_id.",
        },
        { status: 422 }
      );
    }

    return NextResponse.json(result);
  } catch (e) {
    return toErrorResponse(e);
  }
}
