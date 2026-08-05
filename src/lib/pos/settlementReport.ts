import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AuthError, type SessionUser } from "@/lib/auth-server";
import { getDescendantIds, isAdminRole } from "@/lib/security/ownership";
import { toNumber } from "@/lib/money";

/**
 * POS per-transaction SETTLEMENT report — the financial view of every POS swipe
 * a user (and their downline) has done, with MDR deducted, amount settled, and
 * the commission the caller earned on it.
 *
 * Unlike the live feed (which reads the display mirror and is scoped to DIRECT
 * children only), this report:
 *   • drives off `PosSettlementEntry` — the financial ledger that already holds
 *     grossAmount / mdrAmount / netAmount and the swipe-time retailer (`userId`),
 *     so no assignment-window replay is needed for attribution;
 *   • is scoped to the caller's FULL downline (self + all descendants) so a
 *     Distributor sees their retailers, an MD sees distributors + their
 *     retailers, an SD sees the whole subtree;
 *   • includes PENDING entries (today's captures that settle tomorrow, T+1) as
 *     well as SETTLED ones, so "every captured transaction" is visible with the
 *     amount that will be / was credited;
 *   • annotates each row with the caller's own commission for their tier, and
 *     provides a per-downline-user rollup + a full-set summary.
 *
 * Commission is bridged via the synthetic POS transaction: a capture's
 * commission credits hang off `Transaction.refId = "POS:" + transactionRef`.
 */

export type PosReportSettlementStatus = "PENDING" | "SETTLED" | "FAILED";

export type PosSettlementReportFilters = {
  dateFrom: Date;
  dateTo: Date;
  settlementStatus?: PosReportSettlementStatus | null;
  paymentMode?: string | null;
  /** Optional drill-down to a single downline user (must be within scope). */
  retailerId?: string | null;
};

export type PosReportRetailer = {
  id: string;
  name: string;
  shopName: string | null;
  userCode: string | null;
  role: string;
};

export type PosSettlementReportRow = {
  id: string;
  transactionRef: string;
  txnTime: string;
  terminalId: string | null;
  rrn: string | null;
  paymentMode: string | null;
  cardBrand: string | null;
  cardType: string | null;
  /** Swipe status from the display mirror (CAPTURED / REFUNDED / ...). */
  swipeStatus: string | null;
  retailer: PosReportRetailer | null;
  grossAmount: number;
  mdrAmount: number;
  netSettled: number;
  settlementStatus: string;
  settlementMode: string;
  settledVia: string | null;
  settledAt: string | null;
  /** Caller's own commission on this txn (null for retailers/admins). */
  myCommission: number | null;
};

export type PosSettlementReportRollupRow = {
  userId: string;
  name: string;
  shopName: string | null;
  userCode: string | null;
  role: string;
  txnCount: number;
  grossAmount: number;
  mdrAmount: number;
  netSettled: number;
  myCommission: number | null;
};

export type PosSettlementReportSummary = {
  totalTransactions: number;
  totalGross: number;
  totalMdr: number;
  totalSettled: number;
  totalCommission: number | null;
  settledCount: number;
  pendingCount: number;
  failedCount: number;
};

export type PosSettlementReportResult = {
  rows: PosSettlementReportRow[];
  rollup: PosSettlementReportRollupRow[];
  summary: PosSettlementReportSummary;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasPrev: boolean;
    hasNext: boolean;
  };
  /** Whether the commission column is meaningful for this caller. */
  showCommission: boolean;
};

const COMMISSION_ROLES = new Set([
  "DISTRIBUTOR",
  "MASTER_DISTRIBUTOR",
  "SUPER_DISTRIBUTOR",
]);

/** Self + full downline for network roles; `null` (unrestricted) for admins. */
async function resolveAllowedUserIds(user: SessionUser): Promise<string[] | null> {
  if (isAdminRole(user.role)) return null;
  const descendants = await getDescendantIds(user.id);
  return [user.id, ...descendants];
}

function buildWhere(
  allowed: string[] | null,
  filters: PosSettlementReportFilters
): Prisma.PosSettlementEntryWhereInput {
  const where: Prisma.PosSettlementEntryWhereInput = {};

  if (filters.retailerId) {
    where.userId = filters.retailerId;
  } else if (allowed) {
    where.userId = { in: allowed };
  }

  // Filter by the actual swipe time (capturedAt) so late-ingested captures land
  // on their correct day; legacy rows without capturedAt fall back to createdAt.
  where.AND = [
    {
      OR: [
        { capturedAt: { gte: filters.dateFrom, lte: filters.dateTo } },
        {
          capturedAt: null,
          createdAt: { gte: filters.dateFrom, lte: filters.dateTo },
        },
      ],
    },
  ];

  if (filters.settlementStatus) where.status = filters.settlementStatus;
  if (filters.paymentMode) where.paymentMode = filters.paymentMode;

  return where;
}

/** Guard a retailer drill-down against the caller's scope (defense vs IDOR). */
function assertRetailerInScope(
  allowed: string[] | null,
  retailerId: string | null | undefined
): void {
  if (!retailerId) return;
  if (allowed === null) return; // admin — unrestricted
  if (!allowed.includes(retailerId)) {
    throw new AuthError("Forbidden", 403);
  }
}

/**
 * The caller's POS commission credits over the filtered window, mapped both by
 * transactionRef (for the per-txn column) and by transacting user (for rollup),
 * plus the total. Empty for roles that earn no POS commission.
 */
async function loadCommission(
  user: SessionUser,
  allowed: string[] | null,
  filters: PosSettlementReportFilters,
  showCommission: boolean
): Promise<{
  byRef: Map<string, number>;
  byUser: Map<string, number>;
  total: number;
}> {
  const byRef = new Map<string, number>();
  const byUser = new Map<string, number>();
  if (!showCommission) return { byRef, byUser, total: 0 };

  const txnWhere: Prisma.TransactionWhereInput = {
    refId: { startsWith: "POS:" },
  };
  if (filters.retailerId) txnWhere.userId = filters.retailerId;
  else if (allowed) txnWhere.userId = { in: allowed };

  const credits = await prisma.commissionCredit.findMany({
    where: {
      userId: user.id,
      createdAt: { gte: filters.dateFrom, lte: filters.dateTo },
      transaction: txnWhere,
    },
    select: {
      amount: true,
      transaction: { select: { userId: true, refId: true } },
    },
  });

  let total = 0;
  for (const c of credits) {
    const amt = toNumber(c.amount);
    total += amt;
    const ref = c.transaction?.refId?.replace(/^POS:/, "");
    if (ref) byRef.set(ref, (byRef.get(ref) ?? 0) + amt);
    const uid = c.transaction?.userId;
    if (uid) byUser.set(uid, (byUser.get(uid) ?? 0) + amt);
  }

  return { byRef, byUser, total };
}

async function loadSummary(
  where: Prisma.PosSettlementEntryWhereInput,
  totalCommission: number | null
): Promise<PosSettlementReportSummary> {
  const [agg, byStatus] = await Promise.all([
    prisma.posSettlementEntry.aggregate({
      where,
      _sum: { grossAmount: true, mdrAmount: true, netAmount: true },
      _count: { _all: true },
    }),
    prisma.posSettlementEntry.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    }),
  ]);

  const counts: Record<string, number> = {};
  for (const g of byStatus) counts[g.status] = g._count._all;

  return {
    totalTransactions: agg._count._all,
    totalGross: toNumber(agg._sum.grossAmount ?? 0),
    totalMdr: toNumber(agg._sum.mdrAmount ?? 0),
    totalSettled: toNumber(agg._sum.netAmount ?? 0),
    totalCommission,
    settledCount: counts.SETTLED ?? 0,
    pendingCount: counts.PENDING ?? 0,
    failedCount: counts.FAILED ?? 0,
  };
}

async function loadRollup(
  where: Prisma.PosSettlementEntryWhereInput,
  commissionByUser: Map<string, number>,
  showCommission: boolean
): Promise<PosSettlementReportRollupRow[]> {
  const grouped = await prisma.posSettlementEntry.groupBy({
    by: ["userId"],
    where,
    _sum: { grossAmount: true, mdrAmount: true, netAmount: true },
    _count: { _all: true },
  });
  if (grouped.length === 0) return [];

  const users = await prisma.user.findMany({
    where: { id: { in: grouped.map((g) => g.userId) } },
    select: { id: true, name: true, shopName: true, userCode: true, role: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  return grouped
    .map((g) => {
      const u = userById.get(g.userId);
      return {
        userId: g.userId,
        name: u?.name ?? "Unknown",
        shopName: u?.shopName ?? null,
        userCode: u?.userCode ?? null,
        role: u?.role ?? "",
        txnCount: g._count._all,
        grossAmount: toNumber(g._sum.grossAmount ?? 0),
        mdrAmount: toNumber(g._sum.mdrAmount ?? 0),
        netSettled: toNumber(g._sum.netAmount ?? 0),
        myCommission: showCommission ? commissionByUser.get(g.userId) ?? 0 : null,
      };
    })
    .sort((a, b) => b.grossAmount - a.grossAmount);
}

type EntryRow = Prisma.PosSettlementEntryGetPayload<{
  select: {
    id: true;
    transactionRef: true;
    userId: true;
    grossAmount: true;
    mdrAmount: true;
    netAmount: true;
    mode: true;
    status: true;
    settledAt: true;
    settledVia: true;
    paymentMode: true;
    capturedAt: true;
    createdAt: true;
    user: {
      select: { id: true; name: true; shopName: true; userCode: true; role: true };
    };
  };
}>;

const ENTRY_SELECT = {
  id: true,
  transactionRef: true,
  userId: true,
  grossAmount: true,
  mdrAmount: true,
  netAmount: true,
  mode: true,
  status: true,
  settledAt: true,
  settledVia: true,
  paymentMode: true,
  capturedAt: true,
  createdAt: true,
  user: {
    select: { id: true, name: true, shopName: true, userCode: true, role: true },
  },
} satisfies Prisma.PosSettlementEntrySelect;

/** Join the display mirror for the given refs → card / rrn / swipe-time details. */
async function mirrorByRef(refs: string[]) {
  if (refs.length === 0) return new Map<string, {
    txnTime: Date;
    terminalId: string;
    rrn: string | null;
    cardBrand: string | null;
    cardType: string | null;
    status: string;
  }>();
  const rows = await prisma.posTransactionMirror.findMany({
    where: { transactionRef: { in: refs } },
    select: {
      transactionRef: true,
      txnTime: true,
      terminalId: true,
      rrn: true,
      cardBrand: true,
      cardType: true,
      status: true,
    },
  });
  return new Map(rows.map((r) => [r.transactionRef, r]));
}

function toRow(
  e: EntryRow,
  mirror: Awaited<ReturnType<typeof mirrorByRef>>,
  commissionByRef: Map<string, number>,
  showCommission: boolean
): PosSettlementReportRow {
  const m = mirror.get(e.transactionRef);
  const txnTime = (m?.txnTime ?? e.capturedAt ?? e.createdAt).toISOString();
  return {
    id: e.id,
    transactionRef: e.transactionRef,
    txnTime,
    terminalId: m?.terminalId ?? null,
    rrn: m?.rrn ?? null,
    paymentMode: e.paymentMode,
    cardBrand: m?.cardBrand ?? null,
    cardType: m?.cardType ?? null,
    swipeStatus: m?.status ?? null,
    retailer: e.user
      ? {
          id: e.user.id,
          name: e.user.name,
          shopName: e.user.shopName ?? null,
          userCode: e.user.userCode ?? null,
          role: e.user.role,
        }
      : null,
    grossAmount: toNumber(e.grossAmount),
    mdrAmount: toNumber(e.mdrAmount),
    netSettled: toNumber(e.netAmount),
    settlementStatus: e.status,
    settlementMode: e.mode,
    settledVia: e.settledVia,
    settledAt: e.settledAt ? e.settledAt.toISOString() : null,
    myCommission: showCommission ? commissionByRef.get(e.transactionRef) ?? 0 : null,
  };
}

/**
 * Build one page of the report + rollup + summary. All monetary sums are over
 * the FULL filtered set (not just the page).
 */
export async function buildPosSettlementReport(
  user: SessionUser,
  filters: PosSettlementReportFilters,
  page: number,
  pageSize: number
): Promise<PosSettlementReportResult> {
  const allowed = await resolveAllowedUserIds(user);
  assertRetailerInScope(allowed, filters.retailerId);
  const showCommission = COMMISSION_ROLES.has(user.role);

  const where = buildWhere(allowed, filters);

  const [total, entries, commission] = await Promise.all([
    prisma.posSettlementEntry.count({ where }),
    prisma.posSettlementEntry.findMany({
      where,
      orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: ENTRY_SELECT,
    }),
    loadCommission(user, allowed, filters, showCommission),
  ]);

  const mirror = await mirrorByRef(entries.map((e) => e.transactionRef));

  const [summary, rollup] = await Promise.all([
    loadSummary(where, showCommission ? commission.total : null),
    loadRollup(where, commission.byUser, showCommission),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return {
    rows: entries.map((e) => toRow(e, mirror, commission.byRef, showCommission)),
    rollup,
    summary,
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
      hasPrev: page > 1,
      hasNext: page < totalPages,
    },
    showCommission,
  };
}

/**
 * Every row matching the filters (capped), newest first — backs the report
 * export so downloads contain the complete filtered dataset, not one page.
 */
export async function fetchPosSettlementReportRows(
  user: SessionUser,
  filters: PosSettlementReportFilters,
  cap: number
): Promise<{ rows: PosSettlementReportRow[]; total: number; truncated: boolean }> {
  const allowed = await resolveAllowedUserIds(user);
  assertRetailerInScope(allowed, filters.retailerId);
  const showCommission = COMMISSION_ROLES.has(user.role);

  const where = buildWhere(allowed, filters);

  const [total, entries, commission] = await Promise.all([
    prisma.posSettlementEntry.count({ where }),
    prisma.posSettlementEntry.findMany({
      where,
      orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: cap,
      select: ENTRY_SELECT,
    }),
    loadCommission(user, allowed, filters, showCommission),
  ]);

  const mirror = await mirrorByRef(entries.map((e) => e.transactionRef));

  return {
    rows: entries.map((e) => toRow(e, mirror, commission.byRef, showCommission)),
    total,
    truncated: total > entries.length,
  };
}
