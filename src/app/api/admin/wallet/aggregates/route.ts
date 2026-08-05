import { NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth-server";
import {
  getCumulativeBalances,
  getUserWiseBalances,
  BALANCE_TIERS,
  type BalanceTier,
} from "@/lib/wallet/aggregates";
import { getPayinSummary, type PayinPeriod } from "@/lib/wallet/payin";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const PAYIN_PERIODS: readonly PayinPeriod[] = ["today", "week", "month", "year"];

/**
 * GET /api/admin/wallet/aggregates
 *   ?view=cumulative                     → platform liability rollup by tier
 *   ?view=users&role=&q=&page=&pageSize= → user-wise balance listing
 *   ?view=payin&period=today|week|month|year → live payin rollup by rail
 */
export async function GET(req: Request) {
  try {
    await requireRole("MASTER_ADMIN", "ADMIN", "FINANCE");
    const { searchParams } = new URL(req.url);
    const view = searchParams.get("view") ?? "cumulative";

    if (view === "payin") {
      const periodParam = searchParams.get("period") ?? "today";
      const period = (PAYIN_PERIODS as readonly string[]).includes(periodParam)
        ? (periodParam as PayinPeriod)
        : "today";
      return NextResponse.json(await getPayinSummary(period));
    }

    if (view === "users") {
      const roleParam = searchParams.get("role") ?? "ALL";
      const role = (BALANCE_TIERS as readonly string[]).includes(roleParam)
        ? (roleParam as BalanceTier)
        : "ALL";
      const data = await getUserWiseBalances({
        role,
        q: searchParams.get("q") ?? undefined,
        page: Number(searchParams.get("page") ?? 1),
        pageSize: Number(searchParams.get("pageSize") ?? 50),
      });
      return NextResponse.json(data);
    }

    return NextResponse.json(await getCumulativeBalances());
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    console.error("[admin/wallet/aggregates] GET error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
