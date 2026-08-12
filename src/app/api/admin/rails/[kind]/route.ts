import { NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { getCardClassificationSetting } from "@/lib/settings";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/** Parse the [kind] route segment into a supported rail, or null when invalid. */
function parseRail(kind: string): "PG" | "QR" | "BBPS" | "PAYOUT" | null {
  const k = kind.toUpperCase();
  return k === "PG" || k === "QR" || k === "BBPS" || k === "PAYOUT" ? k : null;
}

/**
 * GET /api/admin/rails/:kind — the acquiring providers (pipelines) for a rail
 * (PG or QR) together with each provider's full MDR rate card. Providers are
 * sourced from ServiceRoute (kind = PG/QR); any provider that has rates but is
 * no longer a configured route is still surfaced so its rates remain editable.
 */
export async function GET(_req: Request, { params }: { params: { kind: string } }) {
  try {
    await requireRole("MASTER_ADMIN", "ADMIN", "SUPPORT", "FINANCE");
    const rail = parseRail(params.kind);
    if (!rail) return NextResponse.json({ error: "Unknown rail" }, { status: 404 });

    // BBPS is priced per PRODUCT (each ServiceRoute is its own rate card, keyed
    // by the unique route key) — two products on the same partner (e.g. Same Day
    // Bharat BillPay vs Same Day RechargeKit) must hold separate vendor/minimum
    // rates. Other rails (PG/QR/Payout) remain keyed by the partner (provider).
    const scopeByKey = rail === "BBPS";

    const [routes, rates, cardClassification] = await Promise.all([
      prisma.serviceRoute.findMany({
        where: scopeByKey
          ? { kind: rail, type: "SERVICE" }
          : { kind: rail, provider: { not: null } },
        select: { key: true, provider: true, name: true },
        orderBy: [{ sortOrder: "asc" }],
      }),
      prisma.railMdrRate.findMany({
        where: { serviceKind: rail },
        orderBy: [{ scopeKey: "asc" }, { provider: "asc" }, { minAmount: "asc" }],
      }),
      getCardClassificationSetting(),
    ]);

    // Build the card list (de-duplicated), preserving route order. `partner`
    // records the backing acquirer/partner for display (e.g. two SAMEDAY cards).
    const providers: Array<{ scopeKey: string; name: string; partner: string | null }> = [];
    const seen = new Set<string>();
    for (const r of routes) {
      const scopeKey = scopeByKey ? r.key : r.provider;
      if (!scopeKey || seen.has(scopeKey)) continue;
      seen.add(scopeKey);
      providers.push({ scopeKey, name: r.name, partner: r.provider ?? null });
    }
    // Include orphan scopeKeys that have rates but no matching route.
    for (const rate of rates) {
      if (!seen.has(rate.scopeKey)) {
        seen.add(rate.scopeKey);
        providers.push({ scopeKey: rate.scopeKey, name: rate.scopeLabel ?? rate.scopeKey, partner: null });
      }
    }

    const ratesByScope = new Map<string, typeof rates>();
    for (const r of rates) {
      const list = ratesByScope.get(r.scopeKey) ?? [];
      list.push(r);
      ratesByScope.set(r.scopeKey, list);
    }

    return NextResponse.json({
      rail,
      providers: providers.map((p) => {
        const list = ratesByScope.get(p.scopeKey) ?? [];
        return {
          scopeKey: p.scopeKey,
          name: p.name,
          partner: p.partner,
          rateCount: list.length,
          rates: list.map((r) => ({
            id: r.id,
            provider: r.provider,
            paymentMode: r.paymentMode,
            cardType: r.cardType,
            brandType: r.brandType,
            classification: r.classification,
            minAmount: Number(r.minAmount),
            maxAmount: Number(r.maxAmount),
            mdrType: r.mdrType,
            mdrValue: Number(r.mdrValue),
            mdrValueT0: Number(r.mdrValueT0),
            minMdrValue: Number(r.minMdrValue),
            minMdrValueT0: Number(r.minMdrValueT0),
            active: r.active,
          })),
        };
      }),
      cardClassificationEnabled: cardClassification.enabled,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    console.error("[admin/rails/:kind] GET error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
