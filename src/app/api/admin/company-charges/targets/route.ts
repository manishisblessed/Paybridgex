import { NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/company-charges/targets
 *
 * Dropdown data for per-entity MDR floors. POS is intentionally excluded — its
 * floor is the manually-approved BrandMdrRate (enforced at slab assignment), so
 * only PG pipelines and QR providers are scoped here. Sourced from ServiceRoute
 * rows (provider = the stable scopeKey; name = the display label).
 */
export async function GET() {
  try {
    await requireRole("MASTER_ADMIN", "ADMIN", "FINANCE");
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const routes = await prisma.serviceRoute.findMany({
    where: { kind: { in: ["PG", "QR"] }, provider: { not: null } },
    select: { kind: true, provider: true, name: true },
    orderBy: [{ kind: "asc" }, { sortOrder: "asc" }],
  });

  const targetsByKind: Record<string, Array<{ scopeKey: string; label: string }>> = {
    PG: [],
    QR: [],
  };
  for (const r of routes) {
    if (!r.provider) continue;
    const list = targetsByKind[r.kind];
    if (!list) continue;
    if (!list.some((t) => t.scopeKey === r.provider)) {
      list.push({ scopeKey: r.provider, label: r.name });
    }
  }

  return NextResponse.json({ targetsByKind });
}
