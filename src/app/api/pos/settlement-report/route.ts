import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-server";
import { flags } from "@/lib/env";
import {
  buildPosSettlementReport,
  fetchPosSettlementReportRows,
  type PosSettlementReportFilters,
} from "@/lib/pos/settlementReport";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { assertServiceEnabled } from "@/lib/services/guard";
import { SERVICE_KEYS } from "@/lib/services/catalog";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/** Hard cap on export rows to keep a single download bounded. */
const EXPORT_CAP = 10000;

const schema = z.object({
  date_from: z.string().min(1, "date_from is required"),
  date_to: z.string().min(1, "date_to is required"),
  settlement_status: z.enum(["PENDING", "SETTLED", "FAILED"]).nullable().optional(),
  payment_mode: z
    .enum(["CARD", "UPI", "NFC", "CASH", "WALLET", "NETBANKING", "BHARATQR"])
    .nullable()
    .optional(),
  retailer_id: z.string().nullable().optional(),
  page: z.number().int().positive().optional().default(1),
  page_size: z.number().int().min(1).max(100).optional().default(50),
  /** When true, ignore pagination and return every matching row (capped). */
  export: z.boolean().optional().default(false),
});

/**
 * POST /api/pos/settlement-report
 *
 * Per-transaction POS settlement report scoped to the caller's FULL downline.
 * Shows transaction details, MDR deducted, amount settled, settlement status
 * (SETTLED / PENDING → settles T+1), plus — for Distributor / MD / SD — the
 * commission the caller earned on each swipe, a per-downline-user rollup, and a
 * full-set summary. See src/lib/pos/settlementReport.ts for the data model.
 */
export async function POST(req: Request) {
  let user;
  try {
    user = await requireAuth();
    await assertServiceEnabled(SERVICE_KEYS.POS, {
      name: "POS Terminals",
      userId: user.id,
      role: user.role,
    });
    await enforceRateLimit(`pos:settle-report:${user.id}`, RATE_LIMITS.default);
  } catch (e) {
    return toErrorResponse(e);
  }

  if (!flags.pos) {
    return NextResponse.json({ error: "POS service is not enabled" }, { status: 503 });
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

  const filters: PosSettlementReportFilters = {
    dateFrom,
    dateTo,
    settlementStatus: parsed.data.settlement_status ?? null,
    paymentMode: parsed.data.payment_mode ?? null,
    retailerId: parsed.data.retailer_id?.trim() || null,
  };

  try {
    if (parsed.data.export) {
      const result = await fetchPosSettlementReportRows(user, filters, EXPORT_CAP);
      return NextResponse.json({
        rows: result.rows,
        total: result.total,
        returned: result.rows.length,
        truncated: result.truncated,
      });
    }

    const payload = await buildPosSettlementReport(
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
