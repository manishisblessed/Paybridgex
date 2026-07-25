import { NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth-server";
import { isAdminRole } from "@/lib/security/ownership";
import { prisma } from "@/lib/db";

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

  const [routes, companiesByField, brands] = await Promise.all([
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
            minAmount: true,
            maxAmount: true,
          },
        },
      },
    }),
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
      minAmount: number;
      maxAmount: number;
    }>
  > = {};
  for (const row of companiesByField) {
    const name = row.company?.trim();
    if (!name || !row.brandId) continue;
    const rates = brandRatesById.get(row.brandId);
    if (!rates) continue;
    brandRatesByCompany[name] = rates.map((r) => ({
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
    }));
  }

  return NextResponse.json({
    providersByKind,
    posCompanies: Array.from(companyNames).sort(),
    brandRatesByCompany,
  });
}
