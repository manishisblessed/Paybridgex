import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, AuthError } from "@/lib/auth-server";
import { enforceRateLimit, RATE_LIMITS, RateLimitError } from "@/lib/security/rateLimit";
import { getRevenueReport } from "@/lib/reports/revenue";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/reports/revenue
 *   ?from=YYYY-MM-DD   (IST day; defaults to today)
 *   &to=YYYY-MM-DD     (IST day; defaults to same as `from`)
 *   &service=<ServiceCode>
 *
 * Platform-level revenue & commission report. Shows per-service transaction
 * volumes, charges collected, commission distributed (by tier), and the
 * resulting platform revenue (charge − gross commission).
 */

const QuerySchema = z.object({
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
  service: z.string().trim().max(40).optional(),
});

export async function GET(req: Request) {
  let user;
  try {
    user = await requireRole("MASTER_ADMIN", "ADMIN", "FINANCE");
    await enforceRateLimit(`report:revenue:${user.id}`, RATE_LIMITS.reportQuery);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    if (e instanceof RateLimitError)
      return NextResponse.json({ error: e.message }, { status: 429 });
    throw e;
  }

  const { searchParams } = new URL(req.url);
  const parsed = QuerySchema.safeParse(Object.fromEntries(searchParams.entries()));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const report = await getRevenueReport({
      from: parsed.data.from ?? null,
      to: parsed.data.to ?? null,
      service: parsed.data.service ?? null,
    });
    // The Revenue Wallet (company earnings balance + ledger) is owner-only.
    // Plain admins / finance still get the commission-distribution breakdown
    // (which powers the shared Commission Distributed report), but never the
    // Revenue Wallet balance or its ledger entries.
    if (user.role !== "MASTER_ADMIN") {
      report.wallet = {
        accountId: null,
        accountName: null,
        balance: 0,
        creditedInRange: 0,
        commissionPaidInRange: 0,
        recent: [],
      };
    }
    return NextResponse.json(report);
  } catch (e) {
    console.error("[admin/reports/revenue] error:", e);
    return NextResponse.json({ error: "Failed to generate revenue report" }, { status: 500 });
  }
}
