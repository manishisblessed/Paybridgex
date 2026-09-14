import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { assertKycCurrent, ReKycRequiredError } from "@/lib/security/kycGate";
import { toNumber } from "@/lib/money";
import { quotePayoutForUser, GST_PERCENT } from "@/lib/payout/charges";
import { getSchemeLimit, PAYOUT_MODE_SERVICE } from "@/lib/scheme/resolver";
import { requireActiveScheme, NoSchemeError } from "@/lib/scheme/gate";

// Only IMPS is exposed to the payout UI today. Kept as an enum (not a literal)
// so future modes can be added here without changing every caller.
const QuerySchema = z.object({
  amount: z.coerce.number().positive().max(500000),
  mode: z.enum(["IMPS"]),
});

/** Server-authoritative charge preview for the payout form. */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const NETWORK_ROLES = new Set(["RETAILER", "DISTRIBUTOR", "MASTER_DISTRIBUTOR", "SUPER_DISTRIBUTOR"]);
  let user;
  try {
    user = await requireAuth();
    if (!NETWORK_ROLES.has(user.role)) throw new AuthError("Payout is available for network users only", 403);
    await assertKycCurrent(user);
    // Scheme gate — quote is only meaningful once a scheme is assigned.
    await requireActiveScheme(user.id);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.statusCode });
    if (e instanceof ReKycRequiredError)
      return NextResponse.json({ error: e.message, code: e.code, reKycDueAt: e.dueAt }, { status: e.statusCode });
    if (e instanceof NoSchemeError)
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.statusCode });
    throw e;
  }

  const { searchParams } = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    amount: searchParams.get("amount"),
    mode: searchParams.get("mode"),
  });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const [q, schemeLimit] = await Promise.all([
    quotePayoutForUser(user.id, parsed.data.amount, parsed.data.mode),
    getSchemeLimit(user.id, PAYOUT_MODE_SERVICE[parsed.data.mode]),
  ]);

  // withinLimit is true only when a real scheme slab priced this (amount, mode).
  // A static-fallback price (source !== "USER_SCHEME") means the scheme has no
  // slab covering it — the submit route rejects it, so the UI blocks here too.
  const limit = schemeLimit != null ? toNumber(schemeLimit) : null;
  const withinLimit = q.source === "USER_SCHEME";

  // When no scheme slab covers the amount, do NOT surface the static-fallback
  // charge (that ₹15 is never actually applied — the submit fails closed).
  // Mirror the BBPS/Credit-Card preview and show ₹0 so the UI is consistent.
  const serviceCharge = withinLimit ? toNumber(q.serviceCharge) : 0;
  const gst = withinLimit ? toNumber(q.gst) : 0;
  const totalDebit = withinLimit ? toNumber(q.totalDebit) : toNumber(q.amount);

  return NextResponse.json({
    gstPercent: GST_PERCENT,
    amount: toNumber(q.amount),
    serviceCharge,
    gst,
    totalDebit,
    limit,
    withinLimit,
  });
}
