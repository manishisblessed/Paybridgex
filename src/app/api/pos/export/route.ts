import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-server";
import { enrichPosTransactions } from "@/lib/pos/enrich";
import { prisma } from "@/lib/db";
import { flags } from "@/lib/env";
import { resolvePosScope } from "@/lib/pos/scope";
import { queryMirrorAll, type MirrorQueryFilters } from "@/lib/pos/mirror";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { toErrorResponse } from "@/lib/security/apiErrors";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Hard safety cap so a single export can never build an unbounded payload.
const MAX_ROWS = 10000;

const schema = z.object({
  date_from: z.string().min(1, "date_from is required"),
  date_to: z.string().min(1, "date_to is required"),
  status: z.enum(["AUTHORIZED", "CAPTURED", "FAILED", "REFUNDED", "VOIDED"]).nullable().optional(),
  terminal_id: z.string().nullable().optional(),
  // Admin-only: export every terminal booked under an acquiring company.
  company: z.string().nullable().optional(),
  payment_mode: z.enum(["CARD", "UPI", "NFC", "CASH", "WALLET", "NETBANKING", "BHARATQR"]).nullable().optional(),
});

/**
 * POST /api/pos/export — build a FULL report of every transaction matching the
 * given filters and return the enriched rows as JSON. The client renders them
 * into CSV / PDF / ZIP, so downloads always contain the complete filtered
 * dataset (not just the current page).
 *
 * Reads from the local `PosTransactionMirror` read-model (same source as the
 * live feed), so exports are a single indexed DB query with no partner API
 * dependency, and apply the same ownership scoping as the live feed.
 */
export async function POST(req: Request) {
  let user;
  try {
    user = await requireAuth();
    await enforceRateLimit(`pos:export:${user.id}`, RATE_LIMITS.reportQuery);
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

  const filters = parsed.data;
  const dateFrom = new Date(filters.date_from);
  const dateTo = new Date(filters.date_to);
  if (Number.isNaN(dateFrom.getTime()) || Number.isNaN(dateTo.getTime())) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }

  const companyFilter = filters.company?.trim() || null;

  try {
    // Resolve terminal scope → mirror query (same ownership rules as the feed).
    const scope = await resolvePosScope(user, {
      company: companyFilter,
      terminalId: filters.terminal_id,
    });
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status });
    }

    const mirrorFilters: MirrorQueryFilters = {
      dateFrom,
      dateTo,
      status: filters.status ?? null,
      paymentMode: filters.payment_mode ?? null,
      terminals: scope.terminals,
    };

    const { rows: merged, total, truncated } = await queryMirrorAll(mirrorFilters, MAX_ROWS);
    const rows = await enrichPosTransactions(merged);

    // Audit the export for compliance (sensitive card data surface).
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "pos.export.download",
        entity: "PosExport",
        entityId: `${filters.date_from}_${filters.date_to}`,
        meta: {
          rows: rows.length,
          truncated,
          status: filters.status ?? null,
          payment_mode: filters.payment_mode ?? null,
          terminal_id: filters.terminal_id ?? null,
          company: companyFilter,
        },
      },
    }).catch(() => {});

    return NextResponse.json({
      rows,
      total: total || rows.length,
      returned: rows.length,
      truncated,
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
