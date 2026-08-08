import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-server";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { toErrorResponse } from "@/lib/security/apiErrors";
import {
  buildQrSettlementReport,
  fetchQrSettlementReportRows,
  type QrSettlementReportFilters,
} from "@/lib/qr/settlementReport";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/** Hard cap on export rows to keep a single download bounded. */
const EXPORT_CAP = 10000;

const schema = z.object({
  date_from: z.string().min(1, "date_from is required"),
  date_to: z.string().min(1, "date_to is required"),
  status: z.enum(["UNDER_REVIEW", "SETTLEABLE", "SETTLED", "REJECTED"]).nullable().optional(),
  retailer_id: z.string().nullable().optional(),
  page: z.number().int().positive().optional().default(1),
  page_size: z.number().int().min(1).max(100).optional().default(50),
  /** When true, ignore pagination and return every matching row (capped). */
  export: z.boolean().optional().default(false),
});

/**
 * POST /api/qr/settlement-report
 *
 * Per-transaction QR settlement report scoped to the caller's FULL downline.
 * Shows each claim's gross, scheme MDR deducted, amount settled, and status
 * (Under review / Ready to settle / Settled), plus — for Distributor / MD / SD —
 * the commission the caller earned on it, a per-downline-user rollup, and a
 * full-set summary. Company revenue/margin is NOT exposed (admin-only). See
 * src/lib/qr/settlementReport.ts for the data model.
 */
export async function POST(req: Request) {
  let user;
  try {
    user = await requireAuth();
    await enforceRateLimit(`qr:settle-report:${user.id}`, RATE_LIMITS.default);
  } catch (e) {
    return toErrorResponse(e);
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const dateFrom = new Date(parsed.data.date_from);
  const dateTo = new Date(parsed.data.date_to);
  if (Number.isNaN(dateFrom.getTime()) || Number.isNaN(dateTo.getTime())) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }

  const filters: QrSettlementReportFilters = {
    dateFrom,
    dateTo,
    statusFilter: parsed.data.status ?? null,
    retailerId: parsed.data.retailer_id?.trim() || null,
  };

  try {
    if (parsed.data.export) {
      const result = await fetchQrSettlementReportRows(user, filters, EXPORT_CAP);
      return NextResponse.json({
        rows: result.rows,
        total: result.total,
        returned: result.rows.length,
        truncated: result.truncated,
      });
    }

    const payload = await buildQrSettlementReport(
      user,
      filters,
      parsed.data.page,
      parsed.data.page_size
    );
    return NextResponse.json(payload);
  } catch (e) {
    return toErrorResponse(e);
  }
}
