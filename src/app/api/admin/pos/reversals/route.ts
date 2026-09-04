import { NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { toNumber } from "@/lib/money";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/pos/reversals
 *
 * Reconciliation feed for POS captures that were later VOIDED / REFUNDED
 * upstream (Same Day POS API v2). These no longer count as successful captures
 * anywhere (mirror status flipped, settlement moved to REVERSED), but they must
 * remain VISIBLE so ops can reconcile — especially the ones whose money had
 * already been credited (`needsClawback`).
 *
 * Reads the display mirror (source of truth for what was reversed) and joins the
 * settlement entry to reveal whether money moved.
 */
export async function GET(req: Request) {
  try {
    await requireRole("MASTER_ADMIN", "ADMIN", "FINANCE", "SUPPORT");
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const url = new URL(req.url);
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const from = url.searchParams.get("date_from");
  const to = url.searchParams.get("date_to");
  const statusFilter = url.searchParams.get("status"); // VOIDED | REFUNDED | null
  const needsClawbackOnly = url.searchParams.get("needs_clawback") === "1";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("page_size")) || 25));

  const dateFrom = from ? new Date(from) : defaultFrom;
  const dateTo = to ? new Date(to) : now;
  if (Number.isNaN(dateFrom.getTime()) || Number.isNaN(dateTo.getTime())) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }

  const statuses =
    statusFilter === "VOIDED" || statusFilter === "REFUNDED" ? [statusFilter] : ["VOIDED", "REFUNDED"];

  const where = {
    status: { in: statuses },
    // Reversed swipes are keyed on reversal time so the newest reconciliation
    // items surface first; fall back to txnTime for rows reversed pre-column.
    OR: [
      { reversedAt: { gte: dateFrom, lte: dateTo } },
      { reversedAt: null, txnTime: { gte: dateFrom, lte: dateTo } },
    ],
  };

  const [total, rows] = await Promise.all([
    prisma.posTransactionMirror.count({ where }),
    prisma.posTransactionMirror.findMany({
      where,
      orderBy: [{ reversedAt: "desc" }, { txnTime: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  // Join settlement state so we can flag which reversals moved money.
  const refs = rows.map((r) => r.transactionRef);
  const entries = refs.length
    ? await prisma.posSettlementEntry.findMany({
        where: { transactionRef: { in: refs } },
        select: {
          transactionRef: true,
          status: true,
          netAmount: true,
          walletTxnId: true,
          settledAt: true,
          userId: true,
          user: { select: { name: true, shopName: true, userCode: true, role: true } },
        },
      })
    : [];
  const entryByRef = new Map(entries.map((e) => [e.transactionRef, e]));

  let data = rows.map((r) => {
    const e = entryByRef.get(r.transactionRef);
    // Money left the building if a settlement was ever credited (walletTxnId).
    const wasSettled = !!e?.walletTxnId;
    return {
      transactionRef: r.transactionRef,
      txnId: r.razorpayTxnId,
      terminalId: r.terminalId,
      mid: r.mid,
      amount: toNumber(r.amount),
      status: r.status,
      reversalReason: r.reversalReason,
      reversedAt: r.reversedAt ? r.reversedAt.toISOString() : null,
      txnTime: r.txnTime.toISOString(),
      cardBrand: r.cardBrand,
      cardNumber: r.cardNumber,
      settlement: e
        ? {
            status: e.status,
            netAmount: toNumber(e.netAmount),
            wasSettled,
            settledAt: e.settledAt?.toISOString() ?? null,
            retailer: e.user
              ? `${e.user.shopName || e.user.name}${e.user.userCode ? ` (${e.user.userCode})` : ""}`
              : null,
          }
        : null,
      // The rows that demand action: money credited, awaiting manual clawback.
      needsClawback: wasSettled,
    };
  });

  if (needsClawbackOnly) data = data.filter((d) => d.needsClawback);

  // Full-window tallies (independent of the current page) for the header cards.
  const [voided, refunded, settledReversed] = await Promise.all([
    prisma.posTransactionMirror.count({ where: { ...where, status: { in: ["VOIDED"] } } }),
    prisma.posTransactionMirror.count({ where: { ...where, status: { in: ["REFUNDED"] } } }),
    prisma.posSettlementEntry.findMany({
      where: { status: "REVERSED", walletTxnId: { not: null }, reversedAt: { gte: dateFrom, lte: dateTo } },
      select: { netAmount: true },
    }),
  ]);
  const clawbackAmount = settledReversed.reduce((s, e) => s + toNumber(e.netAmount), 0);

  return NextResponse.json({
    summary: {
      voided_count: voided,
      refunded_count: refunded,
      needs_clawback_count: settledReversed.length,
      needs_clawback_amount: clawbackAmount,
    },
    data,
    pagination: { page, page_size: pageSize, total, total_pages: Math.max(1, Math.ceil(total / pageSize)) },
  });
}
