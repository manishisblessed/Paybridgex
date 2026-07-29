import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-server";
import { getPosTransactions } from "@/lib/partners/sameday-pos";
import { enrichPosTransactions } from "@/lib/pos/enrich";
import { prisma } from "@/lib/db";
import { flags } from "@/lib/env";
import { scopePosTerminals, resolveCompanyTerminals, type ScopedTerminal } from "@/lib/pos/assignments";
import { crawlScopedTransactions } from "@/lib/pos/aggregate";
import { isAdminRole } from "@/lib/security/ownership";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { toErrorResponse } from "@/lib/security/apiErrors";
import type { PosTransaction } from "@/lib/partners/sameday-pos.types";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Partner page size (their max) and a hard safety cap so a single export can
// never spin forever against the partner API. 100 pages × 100 = 10,000 rows,
// which comfortably covers the fleet's real volumes while bounding runtime.
const PARTNER_PAGE_SIZE = 100;
const MAX_PAGES = 100;
const MAX_ROWS = PARTNER_PAGE_SIZE * MAX_PAGES;

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
 * given filters and return the enriched rows as JSON. The client then renders
 * them into CSV / PDF / ZIP with the shared report toolbar, so downloads always
 * contain the complete filtered dataset (not just the current page).
 *
 * We paginate the partner's live transactions endpoint (the async partner
 * export job is unreliable), enrich with retailer + card classification, and
 * apply the same ownership scoping as the live feed.
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

  // Terminals to aggregate over when we can't do a single direct partner query
  // (multi-terminal "all mine" report, or an admin company filter).
  let aggregateTerminals: ScopedTerminal[] | null = null;

  const companyFilter = filters.company?.trim() || null;

  if (companyFilter) {
    // Company filtering spans terminals across many holders, so it's admin-only.
    if (!isAdminRole(user.role))
      return NextResponse.json({ error: "Company filtering is available to admins only" }, { status: 403 });
    aggregateTerminals = await resolveCompanyTerminals(companyFilter);
  } else {
    // Ownership: non-admins may only export their own terminals' transactions.
    // With no terminal picked and several owned, we aggregate across all of them
    // (an "all my terminals" report) instead of forcing a selection.
    const scope = await scopePosTerminals(user);
    if (!scope.all) {
      if (scope.tids.length === 0)
        return NextResponse.json({ error: "No POS terminals are assigned to your account" }, { status: 403 });
      if (filters.terminal_id) {
        if (!scope.tids.includes(filters.terminal_id))
          return NextResponse.json({ error: "You do not have access to that terminal" }, { status: 403 });
      } else if (scope.tids.length === 1) {
        filters.terminal_id = scope.tids[0];
      } else {
        aggregateTerminals = scope.terminals;
      }

      // Clamp date_from so exports only include transactions from after the
      // terminal was assigned to this user/downline. (Aggregation clamps
      // per-terminal internally.)
      if (!aggregateTerminals && filters.terminal_id) {
        const match = scope.terminals.find((t) => t.tid === filters.terminal_id);
        if (match?.assignedAt) {
          const assignedIso = match.assignedAt.toISOString();
          if (filters.date_from < assignedIso) filters.date_from = assignedIso;
        }
      }
    }
  }

  // Aggregated export: crawl every resolved terminal and merge.
  if (aggregateTerminals) {
    const { rows: merged, truncated } = await crawlScopedTransactions(
      aggregateTerminals,
      {
        date_from: filters.date_from,
        date_to: filters.date_to,
        status: filters.status ?? null,
        payment_mode: filters.payment_mode ?? null,
      },
      { maxTotalRows: MAX_ROWS }
    );

    const rows = await enrichPosTransactions(merged);

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
          terminal_id: null,
          company: companyFilter,
          aggregated: true,
        },
      },
    }).catch(() => {});

    return NextResponse.json({
      rows,
      total: rows.length,
      returned: rows.length,
      truncated,
    });
  }

  // Paginate the partner feed until exhausted or the safety cap is hit.
  const all: PosTransaction[] = [];
  let truncated = false;
  let totalRecords = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await getPosTransactions({
      date_from: filters.date_from,
      date_to: filters.date_to,
      status: filters.status ?? null,
      terminal_id: filters.terminal_id ?? null,
      payment_mode: filters.payment_mode ?? null,
      page,
      page_size: PARTNER_PAGE_SIZE,
    });

    if (!result.ok) {
      // If the very first page fails there is nothing to return — surface the
      // upstream failure as a bad-gateway. Later-page failures keep whatever we
      // gathered so the admin still gets a (flagged) partial report.
      if (page === 1) {
        const upstreamStatus = result.status;
        const clientStatus = upstreamStatus === 429 ? 429 : 502;
        return NextResponse.json(
          { error: result.error.error?.message ?? "Failed to fetch POS transactions from partner" },
          { status: clientStatus }
        );
      }
      truncated = true;
      break;
    }

    totalRecords = result.data.pagination?.total_records ?? totalRecords;
    all.push(...result.data.data);

    const hasNext = result.data.pagination?.has_next ?? false;
    if (!hasNext || result.data.data.length === 0) break;

    if (all.length >= MAX_ROWS) {
      truncated = true;
      break;
    }
  }

  const rows = await enrichPosTransactions(all);

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
      },
    },
  }).catch(() => {});

  return NextResponse.json({
    rows,
    total: totalRecords || rows.length,
    returned: rows.length,
    truncated,
  });
}
