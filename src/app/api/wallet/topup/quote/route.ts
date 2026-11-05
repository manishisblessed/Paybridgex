/**
 * GET /api/wallet/topup/quote?amount=X&gateway=chagans:comet
 *
 * Returns a real-time MDR quote for a PG-MDR top-up channel.
 * Shows the retailer what they will actually receive (net) for a given gross.
 *
 * Response:
 *   { priceable: true,  gross, mdr, net }  — scheme slab found
 *   { priceable: false }                   — no scheme / channel not MDR-priced
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-server";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { priceSchemeSettlement } from "@/lib/settlement/engine";
import { isPgMdrProvider, pgScopeForTxn } from "@/lib/wallet/topup";
import { resolveUpiSelection } from "@/lib/partners";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  let user: { id: string };
  try {
    user = await requireAuth();
  } catch (e) {
    return toErrorResponse(e);
  }

  const { searchParams } = new URL(req.url);
  const rawAmount = searchParams.get("amount");
  const gateway = searchParams.get("gateway") ?? undefined;

  const amount = rawAmount ? parseFloat(rawAmount) : NaN;
  if (!isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "amount query param required (>0)" }, { status: 400 });
  }

  const sel = resolveUpiSelection(gateway);
  if (!isPgMdrProvider(sel.provider.name)) {
    return NextResponse.json({ priceable: false });
  }

  const price = await priceSchemeSettlement({
    userId: user.id,
    serviceKind: "PG",
    grossAmount: amount,
    scopeKey: pgScopeForTxn(sel.provider.name),
    settlementType: "T0",
    anyPaymentMode: true,
  });

  if (!price) {
    return NextResponse.json({ priceable: false });
  }

  return NextResponse.json({
    priceable: true,
    gross: amount,
    mdr: price.mdrAmount,
    net: price.netAmount,
  });
}
