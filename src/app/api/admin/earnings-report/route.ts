import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth-server";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { toErrorResponse } from "@/lib/security/apiErrors";
import {
  buildEarningsReport,
  fetchEarningsReportRows,
  type EarningsReportFilters,
} from "@/lib/admin/earningsReport";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const schema = z.object({
  date_from: z.string().min(1, "date_from is required"),
  date_to: z.string().min(1, "date_to is required"),
  rail: z.enum(["POS", "PG", "QR", "UPI"]).nullable().optional(),
  retailer_id: z.string().nullable().optional(),
  page: z.number().int().positive().optional().default(1),
  page_size: z.number().int().min(1).max(100).optional().default(50),
  /** When true, ignore pagination and return every matching row (capped). */
  export: z.boolean().optional().default(false),
});

/**
 * POST /api/admin/earnings-report
 *
 * Platform-owner per-transaction earnings report across all acquiring rails
 * (POS / PG / QR / UPI). Shows the company MDR margin, the commission
 * distributed to each network tier (DT / MD / SD), and the platform's net
 * earning (margin − commission) per transaction — plus a per-merchant rollup
 * and a full-set summary. See src/lib/admin/earningsReport.ts.
 *
 * Admin-only: master-admin, admin, sub-admin (tab-gated), and finance.
 */
export async function POST(req: Request) {
  let user;
  try {
    user = await requireRole("MASTER_ADMIN", "ADMIN", "SUPPORT", "FINANCE");
    await enforceRateLimit(`admin:earnings-report:${user.id}`, RATE_LIMITS.reportQuery);
  } catch (e) {
    return toErrorResponse(e);
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const dateFrom = new Date(parsed.data.date_from);
  const dateTo = new Date(parsed.data.date_to);
  if (Number.isNaN(dateFrom.getTime()) || Number.isNaN(dateTo.getTime())) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }

  const filters: EarningsReportFilters = {
    dateFrom,
    dateTo,
    rail: parsed.data.rail ?? null,
    retailerId: parsed.data.retailer_id?.trim() || null,
  };

  try {
    if (parsed.data.export) {
      const result = await fetchEarningsReportRows(filters);
      return NextResponse.json({
        rows: result.rows,
        total: result.total,
        returned: result.rows.length,
        truncated: result.truncated,
      });
    }

    const payload = await buildEarningsReport(filters, parsed.data.page, parsed.data.page_size);
    return NextResponse.json(payload);
  } catch (e) {
    return toErrorResponse(e);
  }
}
