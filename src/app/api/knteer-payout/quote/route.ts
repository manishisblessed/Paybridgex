/**
 * GET /api/knteer-payout/quote?amount=&mode=IMPS|NEFT
 *
 * Server-authoritative charge preview for the Bank Transfer form. Prices from
 * the KNTEER_PAYOUT scheme slabs and FAILS CLOSED exactly like the submit
 * route: when no slab covers the amount, `withinLimit` is false and the UI must
 * block the transfer. Also returns the slab ceiling and the caller's spendable
 * wallet balance so the form can validate before submit.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { assertKycCurrent, ReKycRequiredError } from "@/lib/security/kycGate";
import { toNumber } from "@/lib/money";
import { getBalances } from "@/lib/ledger";
import { quoteKnteerForUser, GST_PERCENT } from "@/lib/knteer-payout/charges";
import { getSchemeLimit } from "@/lib/scheme/resolver";
import { requireActiveScheme, NoSchemeError } from "@/lib/scheme/gate";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const NETWORK_ROLES = new Set(["RETAILER", "DISTRIBUTOR", "MASTER_DISTRIBUTOR", "SUPER_DISTRIBUTOR"]);

const QuerySchema = z.object({
  amount: z.coerce.number().positive().max(500000),
  mode: z.enum(["IMPS", "NEFT"]).default("IMPS"),
});

export async function GET(req: Request) {
  let user;
  try {
    user = await requireAuth();
    if (!NETWORK_ROLES.has(user.role))
      throw new AuthError("Bank Transfer is available for network users only", 403);
    await assertKycCurrent(user);
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
    mode: searchParams.get("mode") ?? "IMPS",
  });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const [q, schemeLimit, balances] = await Promise.all([
    quoteKnteerForUser(user.id, parsed.data.amount),
    getSchemeLimit(user.id, "KNTEER_PAYOUT"),
    getBalances(user.id),
  ]);

  const limit = schemeLimit != null ? toNumber(schemeLimit) : null;
  // withinLimit is true only when a real KNTEER_PAYOUT slab priced this amount.
  const withinLimit = q.source !== "NONE";

  const serviceCharge = withinLimit ? toNumber(q.serviceCharge) : 0;
  const gst = withinLimit ? toNumber(q.gst) : 0;
  const totalDebit = withinLimit ? toNumber(q.totalDebit) : toNumber(q.amount);
  const spendable = toNumber(balances.spendable);

  return NextResponse.json({
    gstPercent: GST_PERCENT,
    amount: toNumber(q.amount),
    serviceCharge,
    gst,
    totalDebit,
    limit,
    withinLimit,
    spendable,
    affordable: totalDebit <= spendable,
  });
}
