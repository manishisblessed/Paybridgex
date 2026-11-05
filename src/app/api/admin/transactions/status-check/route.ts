import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { isAdminRole } from "@/lib/security/ownership";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { checkProviderStatusOne } from "@/lib/recon/reconcileOne";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/transactions/status-check  { refId }
 *
 * READ-ONLY live provider status probe for a held transaction. It re-polls the
 * rail's status API across every reference we hold and reports the authoritative
 * provider status plus the recovered pay-step reference (request_id). It NEVER
 * moves money or changes a row — it only reads — so ops can see the current
 * provider verdict before choosing to Resolve/verify or force a "Not found —
 * refund". Must run on the IP-whitelisted host (the provider rejects other IPs).
 */
const Body = z.object({ refId: z.string().trim().min(3).max(60) }).strict();

export async function POST(req: Request) {
  try {
    let user;
    try {
      user = await requireAuth();
    } catch (e) {
      if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.statusCode });
      throw e;
    }
    if (!isAdminRole(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // Bounded: each probe makes live provider calls, so cap per-admin frequency.
    await enforceRateLimit(`txn:status-check:${user.id}`, RATE_LIMITS.sensitiveWrite);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    const result = await checkProviderStatusOne(parsed.data.refId);
    if (!result.found)
      return NextResponse.json({ error: "No transaction found for that reference" }, { status: 404 });

    return NextResponse.json(result);
  } catch (e) {
    return toErrorResponse(e);
  }
}
