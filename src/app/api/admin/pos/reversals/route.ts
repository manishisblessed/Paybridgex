import { NextResponse } from "next/server";
import { z } from "zod";
import { type WalletLienStatus } from "@prisma/client";
import { requireRole, AuthError } from "@/lib/auth-server";
import { requireAdminActivity } from "@/lib/security/adminActivity";
import { clientIp } from "@/lib/security/audit";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { prisma } from "@/lib/db";
import { toNumber } from "@/lib/money";
import { placeWalletLien, serializeLien, WalletLienError } from "@/lib/wallet/lien";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/** Liens that count as "clawback already in place" for a reversed entry. A
 *  RELEASED lien (lifted as a false alarm) intentionally does NOT count, so the
 *  row resurfaces as needing action. */
const CLAWBACK_LIEN_STATUSES: WalletLienStatus[] = ["ACTIVE", "RECOVERED"];

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
          id: true,
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

  // Existing clawback liens for these entries (a lien = money already being
  // recovered), so a clawed-back row stops showing as needing action.
  const entryIds = entries.map((e) => e.id);
  const liens = entryIds.length
    ? await prisma.walletLien.findMany({
        where: {
          refType: "PosSettlementEntry",
          refId: { in: entryIds },
          status: { in: CLAWBACK_LIEN_STATUSES },
        },
        select: { id: true, refId: true, amount: true, recoveredAmount: true, status: true },
      })
    : [];
  const lienByEntryId = new Map(liens.map((l) => [l.refId as string, l]));

  let data = rows.map((r) => {
    const e = entryByRef.get(r.transactionRef);
    // Money left the building if a settlement was ever credited (walletTxnId).
    const wasSettled = !!e?.walletTxnId;
    const lien = e ? lienByEntryId.get(e.id) : undefined;
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
      // Clawback in place (lien) — surfaces recovery progress in the UI.
      clawback: lien
        ? {
            lienId: lien.id,
            amount: toNumber(lien.amount),
            recovered: toNumber(lien.recoveredAmount),
            outstanding: Math.max(0, toNumber(lien.amount) - toNumber(lien.recoveredAmount)),
            status: lien.status,
          }
        : null,
      // The rows that demand action: money credited, and no clawback lien yet.
      needsClawback: wasSettled && !lien,
    };
  });

  if (needsClawbackOnly) data = data.filter((d) => d.needsClawback);

  // Full-window tallies (independent of the current page) for the header cards.
  const [voided, refunded, settledReversed] = await Promise.all([
    prisma.posTransactionMirror.count({ where: { ...where, status: { in: ["VOIDED"] } } }),
    prisma.posTransactionMirror.count({ where: { ...where, status: { in: ["REFUNDED"] } } }),
    prisma.posSettlementEntry.findMany({
      where: { status: "REVERSED", walletTxnId: { not: null }, reversedAt: { gte: dateFrom, lte: dateTo } },
      select: { id: true, netAmount: true },
    }),
  ]);
  // Exclude entries that already have a clawback lien in place — only genuinely
  // un-recovered credits count toward "needs clawback".
  const settledIds = settledReversed.map((e) => e.id);
  const settledLienIds = settledIds.length
    ? new Set(
        (
          await prisma.walletLien.findMany({
            where: {
              refType: "PosSettlementEntry",
              refId: { in: settledIds },
              status: { in: CLAWBACK_LIEN_STATUSES },
            },
            select: { refId: true },
          })
        ).map((l) => l.refId as string)
      )
    : new Set<string>();
  const pendingClawback = settledReversed.filter((e) => !settledLienIds.has(e.id));
  const clawbackAmount = pendingClawback.reduce((s, e) => s + toNumber(e.netAmount), 0);

  return NextResponse.json({
    summary: {
      voided_count: voided,
      refunded_count: refunded,
      needs_clawback_count: pendingClawback.length,
      needs_clawback_amount: clawbackAmount,
    },
    data,
    pagination: { page, page_size: pageSize, total, total_pages: Math.max(1, Math.ceil(total / pageSize)) },
  });
}

/**
 * POST /api/admin/pos/reversals — one-click wallet clawback.
 *
 * For a reversed POS capture whose net had ALREADY been credited to the retailer
 * (`needsClawback`), place a CHARGEBACK wallet lien for the settled net. The lien
 * recovers whatever is currently available immediately and auto-sweeps every
 * future incoming credit until fully recovered — so we NEVER force a negative
 * balance (the retailer may already have spent the money). Idempotent: at most
 * one active/recovered clawback lien per settlement entry.
 *
 * Master-admin / admin only (this moves money); finance/support stay read-only.
 */
const ClawbackBody = z.object({
  action: z.literal("clawback"),
  transactionRef: z.string().trim().min(1, "transactionRef is required"),
  note: z.string().trim().max(500).optional(),
});

export async function POST(req: Request) {
  const parsed = ClawbackBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { transactionRef, note } = parsed.data;

  let admin;
  try {
    admin = await requireAdminActivity(req, {
      action: "pos.reversal.clawback",
      roles: ["MASTER_ADMIN", "ADMIN"],
      entity: "PosSettlementEntry",
      entityId: transactionRef,
      body: parsed.data,
    });
  } catch (e) {
    return toErrorResponse(e);
  }

  const entry = await prisma.posSettlementEntry.findUnique({
    where: { transactionRef },
    select: {
      id: true,
      userId: true,
      status: true,
      walletTxnId: true,
      netAmount: true,
      reversalReason: true,
    },
  });
  if (!entry) return NextResponse.json({ error: "Settlement entry not found" }, { status: 404 });
  if (entry.status !== "REVERSED")
    return NextResponse.json({ error: "Only a reversed settlement can be clawed back." }, { status: 409 });
  if (!entry.walletTxnId)
    return NextResponse.json(
      { error: "This reversal never credited a wallet — there is nothing to claw back." },
      { status: 409 }
    );

  // Idempotency: never place a second clawback lien for the same entry.
  const existing = await prisma.walletLien.findFirst({
    where: {
      refType: "PosSettlementEntry",
      refId: entry.id,
      status: { in: CLAWBACK_LIEN_STATUSES },
    },
    select: { id: true },
  });
  if (existing)
    return NextResponse.json(
      { error: "A clawback is already in place for this transaction." },
      { status: 409 }
    );

  const amount = toNumber(entry.netAmount);
  if (!(amount > 0))
    return NextResponse.json(
      { error: "Settled net amount is zero — nothing to claw back." },
      { status: 409 }
    );

  const remarks =
    `POS reversal clawback · ${transactionRef}` +
    (entry.reversalReason ? ` · ${entry.reversalReason}` : "") +
    (note ? ` · ${note}` : "");

  try {
    const lien = await placeWalletLien({
      actorId: admin.id,
      targetUserId: entry.userId,
      amount,
      reasonCode: "CHARGEBACK",
      remarks,
      refType: "PosSettlementEntry",
      refId: entry.id,
      ip: clientIp(req),
    });

    await prisma.auditLog
      .create({
        data: {
          userId: admin.id,
          action: "pos.reversal.clawback",
          entity: "PosSettlementEntry",
          entityId: entry.id,
          meta: {
            transactionRef,
            targetUserId: entry.userId,
            amount,
            recovered: toNumber(lien.recoveredAmount),
            lienId: lien.id,
          } as never,
        },
      })
      .catch(() => {});

    return NextResponse.json({ ok: true, lien: serializeLien(lien) });
  } catch (e) {
    if (e instanceof WalletLienError)
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    return toErrorResponse(e);
  }
}

