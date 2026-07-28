import { NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth-server";
import { isAdminRole } from "@/lib/security/ownership";
import { prisma } from "@/lib/db";
import { getCardClassificationSetting } from "@/lib/settings";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/schemes/meta — dropdown data for the scheme-management UI:
 *   providers:    configured partner routes grouped by service kind
 *                 (BBPS/RECHARGE/DMT/PAYOUT/...), for provider-scoped slabs
 *   posCompanies: distinct acquiring-company labels from POS machines,
 *                 for company-wise MDR rates. Sourced only from the `company`
 *                 field (never `model`, which holds device/brand labels).
 */
export async function GET() {
  try {
    const admin = await requireRole("MASTER_ADMIN", "ADMIN");
    if (!isAdminRole(admin.role))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const [routes, companiesByField, brands, railRoutes, railRates, cardClassification] = await Promise.all([
    prisma.serviceRoute.findMany({
      where: { type: "SERVICE", provider: { not: null } },
      select: { kind: true, provider: true, name: true },
      orderBy: [{ kind: "asc" }, { sortOrder: "asc" }],
    }),
    prisma.posMachine.findMany({
      where: { company: { not: null } },
      select: { company: true, brandId: true },
      distinct: ["company"],
      orderBy: { company: "asc" },
    }),
    prisma.brand.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        rates: {
          where: { active: true },
          select: {
            provider: true,
            paymentMode: true,
            cardType: true,
            brandType: true,
            classification: true,
            mdrType: true,
            mdrValue: true,
            mdrValueT0: true,
            minMdrValue: true,
            minMdrValueT0: true,
            minAmount: true,
            maxAmount: true,
          },
        },
      },
    }),
    // PG/QR pipelines (for the provider label) and their rate cards.
    prisma.serviceRoute.findMany({
      where: { kind: { in: ["PG", "QR"] }, provider: { not: null } },
      select: { kind: true, provider: true, name: true },
      orderBy: [{ kind: "asc" }, { sortOrder: "asc" }],
    }),
    prisma.railMdrRate.findMany({
      where: { serviceKind: { in: ["PG", "QR"] }, active: true },
      select: {
        serviceKind: true,
        scopeKey: true,
        scopeLabel: true,
        provider: true,
        paymentMode: true,
        cardType: true,
        brandType: true,
        classification: true,
        mdrType: true,
        mdrValue: true,
        mdrValueT0: true,
        minAmount: true,
        maxAmount: true,
      },
    }),
    getCardClassificationSetting(),
  ]);

  // De-duplicate providers per kind (multiple routes can share a provider).
  const providersByKind: Record<string, Array<{ provider: string; name: string }>> = {};
  for (const r of routes) {
    if (!r.provider) continue;
    const list = (providersByKind[r.kind] ??= []);
    if (!list.some((p) => p.provider === r.provider)) {
      list.push({ provider: r.provider, name: r.name });
    }
  }

  const companyNames = new Set<string>();
  for (const c of companiesByField) {
    const name = c.company?.trim();
    if (name) companyNames.add(name);
  }

  // Build brand rates indexed by brandId for fast lookup.
  const brandRatesById = new Map<string, typeof brands[number]["rates"]>();
  for (const b of brands) {
    if (b.rates.length > 0) brandRatesById.set(b.id, b.rates);
  }

  // Map company → brand rates (from PosMachine.company → brandId → BrandMdrRate).
  const brandRatesByCompany: Record<
    string,
    Array<{
      provider: string;
      paymentMode: string;
      cardType: string | null;
      brandType: string | null;
      classification: string | null;
      mdrType: string;
      mdrValue: number;
      mdrValueT0: number;
      minMdrValue: number;
      minMdrValueT0: number;
      minAmount: number;
      maxAmount: number;
    }>
  > = {};
  const mapRate = (r: typeof brands[number]["rates"][number]) => ({
    provider: r.provider,
    paymentMode: r.paymentMode,
    cardType: r.cardType,
    brandType: r.brandType,
    classification: r.classification,
    mdrType: r.mdrType,
    mdrValue: Number(r.mdrValue),
    mdrValueT0: Number(r.mdrValueT0),
    minMdrValue: Number(r.minMdrValue),
    minMdrValueT0: Number(r.minMdrValueT0),
    minAmount: Number(r.minAmount),
    maxAmount: Number(r.maxAmount),
  });

  // 1. Machine-derived companies (PosMachine.company → brandId → rates). Covers
  //    fleets whose acquiring-company label differs from the brand name.
  for (const row of companiesByField) {
    const name = row.company?.trim();
    if (!name || !row.brandId) continue;
    const rates = brandRatesById.get(row.brandId);
    if (!rates) continue;
    brandRatesByCompany[name] = rates.map(mapRate);
  }

  // 2. Every active BRAND that has rates, keyed by brand name — so a brand with
  //    an approved rate card is eligible for scheme POS MDR even before any POS
  //    machine is assigned to it (findApprovedBrandRate resolves the vendor cost
  //    by brand name when no machine links the company). Machine-keyed entries
  //    above win on exact label collisions.
  for (const b of brands) {
    const name = b.name?.trim();
    if (!name || b.rates.length === 0) continue;
    if (!brandRatesByCompany[name]) brandRatesByCompany[name] = b.rates.map(mapRate);
    companyNames.add(name);
  }

  // ---- PG / QR rail rate cards (the POS-brand analogue for PG/QR) ----
  // railRatesByKind[kind][scopeKey] = the provider's active rate card, used by
  // the scheme MDR modal to lock the vendor cost. railProvidersByKind lists only
  // providers that actually have rates (mirrors the POS company restriction).
  type RailRate = {
    provider: string;
    paymentMode: string;
    cardType: string | null;
    brandType: string | null;
    classification: string | null;
    mdrType: string;
    mdrValue: number;
    mdrValueT0: number;
    minAmount: number;
    maxAmount: number;
  };
  const railRatesByKind: Record<"PG" | "QR", Record<string, RailRate[]>> = { PG: {}, QR: {} };
  const railLabels = new Map<string, string>(); // `${kind}:${scopeKey}` -> label
  for (const r of railRoutes) {
    if (r.provider) railLabels.set(`${r.kind}:${r.provider}`, r.name);
  }
  for (const r of railRates) {
    const kind = r.serviceKind as "PG" | "QR";
    const bucket = (railRatesByKind[kind][r.scopeKey] ??= []);
    bucket.push({
      provider: r.provider,
      paymentMode: r.paymentMode,
      cardType: r.cardType,
      brandType: r.brandType,
      classification: r.classification,
      mdrType: r.mdrType,
      mdrValue: Number(r.mdrValue),
      mdrValueT0: Number(r.mdrValueT0),
      minAmount: Number(r.minAmount),
      maxAmount: Number(r.maxAmount),
    });
    if (r.scopeLabel) railLabels.set(`${kind}:${r.scopeKey}`, railLabels.get(`${kind}:${r.scopeKey}`) ?? r.scopeLabel);
  }
  const railProvidersByKind: Record<"PG" | "QR", Array<{ scopeKey: string; label: string }>> = {
    PG: [],
    QR: [],
  };
  for (const kind of ["PG", "QR"] as const) {
    railProvidersByKind[kind] = Object.keys(railRatesByKind[kind])
      .map((scopeKey) => ({ scopeKey, label: railLabels.get(`${kind}:${scopeKey}`) ?? scopeKey }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  return NextResponse.json({
    providersByKind,
    posCompanies: Array.from(companyNames).sort(),
    brandRatesByCompany,
    railProvidersByKind,
    railRatesByKind,
    // Whether card classification (tier) pricing is active. When false the
    // scheme/brand editors hide the Classification field (MDR uses Card Category).
    cardClassificationEnabled: cardClassification.enabled,
  });
}
