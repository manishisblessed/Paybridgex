import { NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { getCardClassificationSetting } from "@/lib/settings";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/** Parse the [kind] route segment into a PG/QR rail, or null when invalid. */
function parseRail(kind: string): "PG" | "QR" | null {
  const k = kind.toUpperCase();
  return k === "PG" || k === "QR" ? k : null;
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

    const [routes, rates, cardClassification] = await Promise.all([
      prisma.serviceRoute.findMany({
        where: { kind: rail, provider: { not: null } },
        select: { provider: true, name: true },
        orderBy: [{ sortOrder: "asc" }],
      }),
      prisma.railMdrRate.findMany({
        where: { serviceKind: rail },
        orderBy: [{ scopeKey: "asc" }, { provider: "asc" }, { minAmount: "asc" }],
      }),
      getCardClassificationSetting(),
    ]);

    // Build the provider list (de-duplicated), preserving route order.
    const providers: Array<{ scopeKey: string; name: string }> = [];
    const seen = new Set<string>();
    for (const r of routes) {
      if (!r.provider || seen.has(r.provider)) continue;
      seen.add(r.provider);
      providers.push({ scopeKey: r.provider, name: r.name });
    }
    // Include orphan scopeKeys that have rates but no matching route.
    for (const rate of rates) {
      if (!seen.has(rate.scopeKey)) {
        seen.add(rate.scopeKey);
        providers.push({ scopeKey: rate.scopeKey, name: rate.scopeLabel ?? rate.scopeKey });
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
