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
    /**
     * When the admin confirms the transaction does NOT exist in the provider
     * panel (ORDER_NOT_FOUND), this flag authorizes a safe refund of the held
     * reserve. The API still re-verifies that the provider returns NOT_FOUND
     * for every candidate ref before acting — it never blind-refunds.
     */
    forceRefundNotFound: z.boolean().optional(),
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
      forceRefundNotFound: parsed.data.forceRefundNotFound,
    });

    if (!result.found)
      return NextResponse.json({ error: "No transaction found for that reference" }, { status: 404 });

    // The provider confirmed SUCCESS but for a DIFFERENT amount than this row —
    // the twin double-attempt trap. Refuse and surface both amounts so the
    // operator corrects the right leg instead of clawing back the wrong one.
    if (result.outcome === "amount_mismatch") {
      return NextResponse.json(
        {
          ...result,
          error:
            `Provider reports SUCCESS for ₹${result.providerAmount ?? "?"}, but this row is a different amount. ` +
            "This looks like a twin double-attempt — verify which attempt actually paid before resolving.",
        },
        { status: 409 }
      );
    }

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
