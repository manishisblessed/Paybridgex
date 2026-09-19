import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminActivity } from "@/lib/security/adminActivity";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { reconcileOneTransaction } from "@/lib/recon/reconcileOne";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/transactions/reconcile  { refId }
 *
 * Force-reconcile ONE stuck service transaction by reference (our `refId` or the
 * provider `partnerTxnId`). This is the safe, targeted ops tool for a payment
 * left in PROCESSING: it RE-POLLS the provider's authoritative status and
 * settles or auto-refunds through the shared idempotent finalizer. It never
 * blind-refunds a possibly-charged card, and racing with the webhook/sweep is a
 * no-op.
 *
 * Supports the RechargeKit CC-2 and BBPS rails (the only rails that can sit in
 * PROCESSING awaiting an out-of-band terminal state).
 */
const Body = z.object({ refId: z.string().trim().min(3).max(60) }).strict();

export async function POST(req: Request) {
  try {
    const admin = await requireAdminActivity(req, {
      action: "txn.reconcile",
      roles: ["MASTER_ADMIN", "ADMIN"],
      entity: "Transaction",
    });
    await enforceRateLimit(`txn:reconcile:${admin.id}`, RATE_LIMITS.sensitiveWrite);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    const result = await reconcileOneTransaction(parsed.data.refId);
    if (!result.found)
      return NextResponse.json({ error: "No transaction found for that reference" }, { status: 404 });

    return NextResponse.json(result);
  } catch (e) {
    return toErrorResponse(e);
  }
}
