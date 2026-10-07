import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, AuthError, type SessionUser } from "@/lib/auth-server";
import {
  buildPosSettlementReport,
  fetchPosSettlementReportRows,
  type PosSettlementReportFilters,
} from "@/lib/pos/settlementReport";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { toErrorResponse } from "@/lib/security/apiErrors";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/** Hard cap on export rows to keep a single download bounded. */
const EXPORT_CAP = 10000;

/**
 * Who may view the platform-wide POS settlement report. Master-admin / admin
 * (and read-only FINANCE oversight) always; a SUPPORT sub-admin only when the
 * "pos-settlement" tab is assigned to them (an empty allowlist = full access,
 * mirroring the sidebar + joinAccess/wallet-ops gating patterns).
 */
function canViewPosSettlementReport(user: SessionUser): boolean {
  if (user.role === "MASTER_ADMIN" || user.role === "ADMIN" || user.role === "FINANCE") {
    return true;
  }
  if (user.role === "SUPPORT") {
    const tabs = user.allowedTabs ?? [];
    return tabs.length === 0 || tabs.includes("pos-settlement");
  }
  return false;
}

const schema = z.object({
  date_from: z.string().min(1, "date_from is required"),
  date_to: z.string().min(1, "date_to is required"),
  settlement_status: z.enum(["PENDING", "SETTLED", "FAILED"]).nullable().optional(),
  payment_mode: z
    .enum(["CARD", "UPI", "NFC", "CASH", "WALLET", "NETBANKING", "BHARATQR"])
    .nullable()
    .optional(),
  // For an admin this is a free "filter to a specific user" (any user id on the
  // platform) — scope is unrestricted, so the lib's in-scope guard is a no-op.
  retailer_id: z.string().nullable().optional(),
  page: z.number().int().positive().optional().default(1),
  page_size: z.number().int().min(1).max(100).optional().default(50),
  /** When true, ignore pagination and return every matching row (capped). */
  export: z.boolean().optional().default(false),
});

/**
 * POST /api/admin/pos-settlement-report
 *
 * Platform-wide (master-admin) analogue of /api/pos/settlement-report. Because
 * the caller is a staff role, {@link buildPosSettlementReport} resolves an
 * UNRESTRICTED scope (every user's entries roll up), giving admins the full
 * per-user transaction + settlement picture: Today's Book (instant-today vs
 * T+1-tomorrow), the By-User historical split (instant vs T+1 settled vs
 * pending), and the per-transaction ledger. See src/lib/pos/settlementReport.ts.
 */
export async function POST(req: Request) {
  let user: SessionUser;
  try {
    user = await requireAuth();
    if (!canViewPosSettlementReport(user)) {
      throw new AuthError("Forbidden", 403);
    }
    await enforceRateLimit(`admin:pos-settle-report:${user.id}`, RATE_LIMITS.reportQuery);
  } catch (e) {
    return toErrorResponse(e);
  }

  const body = await req.json().catch(() => ({}));
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
