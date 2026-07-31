import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-server";
import { flags } from "@/lib/env";
import { resolvePosScope } from "@/lib/pos/scope";
import { buildPosFeedResponse } from "@/lib/pos/feed";
import { type MirrorQueryFilters } from "@/lib/pos/mirror";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { assertServiceEnabled } from "@/lib/services/guard";
import { SERVICE_KEYS } from "@/lib/services/catalog";

export const fetchCache = "force-no-store";

export const dynamic = "force-dynamic";

const schema = z.object({
  date_from: z.string().min(1, "date_from is required"),
  date_to: z.string().min(1, "date_to is required"),
  status: z.enum(["AUTHORIZED", "CAPTURED", "FAILED", "REFUNDED", "VOIDED"]).nullable().optional(),
  terminal_id: z.string().nullable().optional(),
  // Admin-only: aggregate every terminal booked under an acquiring company.
  company: z.string().nullable().optional(),
  payment_mode: z.enum(["CARD", "UPI", "NFC", "CASH", "WALLET", "NETBANKING", "BHARATQR"]).nullable().optional(),
  page: z.number().int().positive().optional().default(1),
  page_size: z.number().int().min(1).max(100).optional().default(50),
});

/**
 * POST /api/pos/transactions
 *
 * Serves one page of the POS "Live Transactions" feed from the local
 * `PosTransactionMirror` read-model — NOT the partner API. The mirror is kept
 * current by the real-time capture webhook plus a periodic reconciliation
 * sweep, so this is a fast, indexed DB query with no dependency on the partner's
 * 100 req/min rate limit.
 *
 * This remains the paginated / one-shot fetch path; the browser's LIVE feed now
 * subscribes to GET /api/pos/transactions/stream (SSE) instead of polling here.
 */
export async function POST(req: Request) {
  let user;
  try {
    user = await requireAuth();
    // Admin kill-switch + per-user allowlist (default-disabled) for this rail.
    await assertServiceEnabled(SERVICE_KEYS.POS, { name: "POS Terminals", userId: user.id, role: user.role });
    await enforceRateLimit(`pos:txn:${user.id}`, RATE_LIMITS.default);
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

  try {
    const companyFilter = parsed.data.company?.trim() || null;
    const scope = await resolvePosScope(user, {
      company: companyFilter,
      terminalId: parsed.data.terminal_id,
    });
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status });
    }

    const filters: MirrorQueryFilters = {
      dateFrom,
      dateTo,
      status: parsed.data.status ?? null,
      paymentMode: parsed.data.payment_mode ?? null,
      terminals: scope.terminals,
    };

    const payload = await buildPosFeedResponse(
      filters,
      parsed.data.page,
      parsed.data.page_size,
      companyFilter
    );
    return NextResponse.json(payload);
  } catch (e) {
    return toErrorResponse(e);
  }
}
