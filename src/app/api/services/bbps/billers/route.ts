import { NextResponse } from "next/server";
import { z } from "zod";
import { getPartner } from "@/lib/partners";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth-server";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { assertServiceEnabled } from "@/lib/services/guard";
import { SERVICE_KEYS } from "@/lib/services/catalog";
import { bbpsServiceKey } from "@/lib/services/bbpsKey";
import { friendlyPartnerError } from "@/lib/partners/friendlyError";
import { AuthError } from "@/lib/auth-server";

/**
 * GET /api/services/bbps/billers?category=CREDIT_CARD
 *
 * Live biller catalog. Providers that expose one (Same Day Pay2New for
 * credit cards) are queried directly; other categories fall back to the
 * seeded Biller table.
 */
const Category = z.enum(["ELECTRICITY", "WATER", "GAS", "CREDIT_CARD", "EDUCATION", "INSURANCE", "BROADBAND"]);

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  let user;
  try {
    user = await requireAuth();
    if (user.role !== "RETAILER") throw new AuthError("BBPS is available for retailers only", 403);
    await assertServiceEnabled(SERVICE_KEYS.BBPS, { name: "Bill Payments", userId: user.id, role: user.role });
    const catKey = bbpsServiceKey(url.searchParams.get("category") ?? "CREDIT_CARD");
    if (catKey) await assertServiceEnabled(catKey, { name: "Bill Payments", userId: user.id, role: user.role });
    await enforceRateLimit(`bbps:billers:${user.id}`, RATE_LIMITS.default);
  } catch (e) {
    return toErrorResponse(e);
  }

  const parsed = Category.safeParse(url.searchParams.get("category") ?? "CREDIT_CARD");
  if (!parsed.success) return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  const category = parsed.data;

  const bbps = getPartner("bbps");
  if (bbps.billers) {
    const r = await bbps.billers(category);
    if (r.ok) return NextResponse.json({ source: bbps.name, billers: r.data });
    // Provider errored (or doesn't serve this category) — fall through to DB.
    if (r.code !== "UNSUPPORTED_CATEGORY") {
      return NextResponse.json(
        { error: friendlyPartnerError(r.code, r.message, "fetch"), code: r.code },
        { status: 502 }
      );
    }
  }

  const rows = await prisma.biller.findMany({
    where: { category, active: true },
    select: { code: true, name: true, state: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({
    source: "CATALOG",
    billers: rows.map((b) => ({ code: b.code, name: b.name, category, state: b.state })),
  });
}
