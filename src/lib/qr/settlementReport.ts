import type { Prisma, QrClaimStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AuthError, type SessionUser } from "@/lib/auth-server";
import { getDescendantIds, isAdminRole } from "@/lib/security/ownership";
import { toNumber } from "@/lib/money";

/**
 * QR per-transaction SETTLEMENT report — the network-facing financial view of
 * every QR claim a user (and their downline) has made, with the scheme MDR
 * deducted, the amount settled to the retailer wallet, the claim's settlement
 * status, and — for Distributor / MD / SD — the commission the caller earned on
 * it. It is the direct QR analogue of the POS Settlement Report
 * (src/lib/pos/settlementReport.ts):
 *
 *   • drives off `QrClaim` (already holds amount / mdrAmount / netAmount and the
 *     retailer `userId`), so attribution needs no replay;
 *   • is scoped to the caller's FULL downline (self + all descendants) so a
 *     Distributor sees their retailers, an MD sees distributors + their
 *     retailers, an SD sees the whole subtree; admins are unrestricted;
 *   • includes not-yet-settled claims (UNDER REVIEW, and SETTLEABLE — "approved
 *     & ready to settle") alongside SETTLED ones, so the whole settlement
 *     pipeline is visible;
 *   • annotates each row with the caller's own commission for their tier, and
 *     provides a per-downline-user rollup + a full-set summary.
 *
 * Company revenue/margin is intentionally NOT exposed here — that stays an
 * admin-only view (`/dashboard/admin/earnings`). Uplines see only gross, MDR,
 * net settled, status and their OWN commission.
 *
 * Commission is bridged via the synthetic QR transaction: a claim's commission
 * credits hang off `Transaction.refId = "QR" + last10(claimId).toUpperCase()`
 * (see distributeCommissionForQr in src/lib/qr/claims.ts).
 */

/** The synthetic-transaction refId a claim's commission credits hang off. */
export function qrCommissionRefId(claimId: string): string {
  return `QR${claimId.slice(-10).toUpperCase()}`;
}

export type QrReportStatusFilter = "UNDER_REVIEW" | "SETTLEABLE" | "SETTLED" | "REJECTED";

/** UI status filter → the underlying QrClaim statuses it covers. */
const STATUS_GROUPS: Record<QrReportStatusFilter, QrClaimStatus[]> = {
  UNDER_REVIEW: ["PENDING", "AWAITING_SECOND_APPROVAL"],
  SETTLEABLE: ["SETTLEABLE"],
  SETTLED: ["APPROVED", "SETTLED"],
  REJECTED: ["REJECTED", "CLAWED_BACK"],
};

/** Human label for a claim status (mirrors the retailer QR dashboard badges). */
export function qrStatusLabel(status: QrClaimStatus): string {
  switch (status) {
    case "PENDING":
    case "AWAITING_SECOND_APPROVAL":
      return "Under review";
    case "APPROVED":
      return "Credited";
    case "SETTLEABLE":
      return "Ready to settle";
    case "SETTLED":
      return "Settled";
    case "REJECTED":
      return "Rejected";
    case "CLAWED_BACK":
      return "Reversed";
    default:
      return status;
  }
}

export type QrSettlementReportFilters = {
  dateFrom: Date;
  dateTo: Date;
  statusFilter?: QrReportStatusFilter | null;
  /** Optional drill-down to a single downline user (must be within scope). */
  retailerId?: string | null;
};

export type QrReportRetailer = {
  id: string;
  name: string;
  shopName: string | null;
  userCode: string | null;
  role: string;
};

export type QrSettlementReportRow = {
  id: string;
  utr: string;
  qrLabel: string | null;
  /** When the customer paid (per the retailer). */
  txnTime: string;
  /** When the claim was filed. */
  submittedAt: string;
  retailer: QrReportRetailer | null;
  grossAmount: number;
  /** Scheme MDR deducted — only known once SETTLED (null while pending). */
  mdrAmount: number | null;
  /** gross − MDR credited to the retailer wallet — null while pending. */
  netSettled: number | null;
  status: QrClaimStatus;
  statusLabel: string;
  settledVia: string | null;
  settledAt: string | null;
  /** Caller's own commission on this claim (null for retailers/admins). */
  myCommission: number | null;
};

export type QrSettlementReportRollupRow = {
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

export type QrSettlementReportSummary = {
  totalTransactions: number;
  totalGross: number;
  totalMdr: number;
  totalSettled: number;
  totalCommission: number | null;
  settleableCount: number;
  settledCount: number;
  underReviewCount: number;
};

export type QrSettlementReportResult = {
  rows: QrSettlementReportRow[];
  rollup: QrSettlementReportRollupRow[];
  summary: QrSettlementReportSummary;
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

const SETTLED_STATUSES: QrClaimStatus[] = ["APPROVED", "SETTLED"];

/** Self + full downline for network roles; `null` (unrestricted) for admins. */
async function resolveAllowedUserIds(user: SessionUser): Promise<string[] | null> {
  if (isAdminRole(user.role)) return null;
  const descendants = await getDescendantIds(user.id);
  return [user.id, ...descendants];
}

function buildWhere(
  allowed: string[] | null,
  filters: QrSettlementReportFilters
): Prisma.QrClaimWhereInput {
  const where: Prisma.QrClaimWhereInput = {};

  if (filters.retailerId) {
    where.userId = filters.retailerId;
  } else if (allowed) {
    where.userId = { in: allowed };
  }

  where.createdAt = { gte: filters.dateFrom, lte: filters.dateTo };

  if (filters.statusFilter) {
    where.status = { in: STATUS_GROUPS[filters.statusFilter] };
  }

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
 * The caller's QR commission credits over the filtered window, mapped both by
 * synthetic-transaction refId (for the per-txn column) and by transacting user
 * (for the rollup), plus the total. Empty for roles that earn no commission.
 */
async function loadCommission(
  user: SessionUser,
  allowed: string[] | null,
  filters: QrSettlementReportFilters,
  showCommission: boolean
): Promise<{ byRef: Map<string, number>; byUser: Map<string, number>; total: number }> {
  const byRef = new Map<string, number>();
  const byUser = new Map<string, number>();
  if (!showCommission) return { byRef, byUser, total: 0 };

  const txnWhere: Prisma.TransactionWhereInput = {
    refId: { startsWith: "QR" },
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
    const ref = c.transaction?.refId;
    if (ref) byRef.set(ref, (byRef.get(ref) ?? 0) + amt);
    const uid = c.transaction?.userId;
    if (uid) byUser.set(uid, (byUser.get(uid) ?? 0) + amt);
  }

  return { byRef, byUser, total };
}

async function loadSummary(
  where: Prisma.QrClaimWhereInput,
  totalCommission: number | null
): Promise<QrSettlementReportSummary> {
  const [agg, settledAgg, byStatus] = await Promise.all([
    prisma.qrClaim.aggregate({
      where,
      _sum: { amount: true },
      _count: { _all: true },
    }),
    // MDR/net are only populated once settled — sum them over settled rows only.
    prisma.qrClaim.aggregate({
      where: { ...where, status: { in: SETTLED_STATUSES } },
      _sum: { mdrAmount: true, netAmount: true },
    }),
    prisma.qrClaim.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    }),
  ]);

  const counts: Record<string, number> = {};
  for (const g of byStatus) counts[g.status] = g._count._all;

  return {
    totalTransactions: agg._count._all,
    totalGross: toNumber(agg._sum.amount ?? 0),
    totalMdr: toNumber(settledAgg._sum.mdrAmount ?? 0),
    totalSettled: toNumber(settledAgg._sum.netAmount ?? 0),
    totalCommission,
    settleableCount: counts.SETTLEABLE ?? 0,
    settledCount: (counts.SETTLED ?? 0) + (counts.APPROVED ?? 0),
    underReviewCount: (counts.PENDING ?? 0) + (counts.AWAITING_SECOND_APPROVAL ?? 0),
  };
}

async function loadRollup(
  where: Prisma.QrClaimWhereInput,
  commissionByUser: Map<string, number>,
  showCommission: boolean
): Promise<QrSettlementReportRollupRow[]> {
  const grouped = await prisma.qrClaim.groupBy({
    by: ["userId"],
    where,
    _sum: { amount: true, mdrAmount: true, netAmount: true },
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
        grossAmount: toNumber(g._sum.amount ?? 0),
        mdrAmount: toNumber(g._sum.mdrAmount ?? 0),
        netSettled: toNumber(g._sum.netAmount ?? 0),
        myCommission: showCommission ? commissionByUser.get(g.userId) ?? 0 : null,
      };
    })
    .sort((a, b) => b.grossAmount - a.grossAmount);
}

type ClaimRow = Prisma.QrClaimGetPayload<{
  select: {
    id: true;
    utr: true;
    userId: true;
    amount: true;
    mdrAmount: true;
    netAmount: true;
    paidAt: true;
    createdAt: true;
    status: true;
    settledAt: true;
    settledVia: true;
    qr: { select: { label: true } };
    user: { select: { id: true; name: true; shopName: true; userCode: true; role: true } };
  };
}>;

const CLAIM_SELECT = {
  id: true,
  utr: true,
  userId: true,
  amount: true,
  mdrAmount: true,
  netAmount: true,
  paidAt: true,
  createdAt: true,
  status: true,
  settledAt: true,
  settledVia: true,
  qr: { select: { label: true } },
  user: { select: { id: true, name: true, shopName: true, userCode: true, role: true } },
} satisfies Prisma.QrClaimSelect;

function toRow(
  c: ClaimRow,
  commissionByRef: Map<string, number>,
  showCommission: boolean
): QrSettlementReportRow {
  const isSettled = c.status === "SETTLED" || c.status === "APPROVED";
  return {
    id: c.id,
    utr: c.utr,
    qrLabel: c.qr?.label ?? null,
    txnTime: c.paidAt.toISOString(),
    submittedAt: c.createdAt.toISOString(),
    retailer: c.user
      ? {
          id: c.user.id,
          name: c.user.name,
          shopName: c.user.shopName ?? null,
          userCode: c.user.userCode ?? null,
          role: c.user.role,
        }
      : null,
    grossAmount: toNumber(c.amount),
    mdrAmount: isSettled && c.mdrAmount != null ? toNumber(c.mdrAmount) : null,
    netSettled: isSettled && c.netAmount != null ? toNumber(c.netAmount) : null,
    status: c.status,
    statusLabel: qrStatusLabel(c.status),
    settledVia: c.settledVia,
    settledAt: c.settledAt ? c.settledAt.toISOString() : null,
    myCommission: showCommission ? commissionByRef.get(qrCommissionRefId(c.id)) ?? 0 : null,
  };
}

/**
 * Build one page of the report + rollup + summary. All monetary sums are over
 * the FULL filtered set (not just the page).
 */
export async function buildQrSettlementReport(
  user: SessionUser,
  filters: QrSettlementReportFilters,
  page: number,
  pageSize: number
): Promise<QrSettlementReportResult> {
  const allowed = await resolveAllowedUserIds(user);
  assertRetailerInScope(allowed, filters.retailerId);
  const showCommission = COMMISSION_ROLES.has(user.role);

  const where = buildWhere(allowed, filters);

  const [total, claims, commission] = await Promise.all([
    prisma.qrClaim.count({ where }),
    prisma.qrClaim.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: CLAIM_SELECT,
    }),
    loadCommission(user, allowed, filters, showCommission),
  ]);

  const [summary, rollup] = await Promise.all([
    loadSummary(where, showCommission ? commission.total : null),
    loadRollup(where, commission.byUser, showCommission),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return {
    rows: claims.map((c) => toRow(c, commission.byRef, showCommission)),
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
export async function fetchQrSettlementReportRows(
  user: SessionUser,
  filters: QrSettlementReportFilters,
  cap: number
): Promise<{ rows: QrSettlementReportRow[]; total: number; truncated: boolean }> {
  const allowed = await resolveAllowedUserIds(user);
  assertRetailerInScope(allowed, filters.retailerId);
  const showCommission = COMMISSION_ROLES.has(user.role);

  const where = buildWhere(allowed, filters);

  const [total, claims, commission] = await Promise.all([
    prisma.qrClaim.count({ where }),
    prisma.qrClaim.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: cap,
      select: CLAIM_SELECT,
    }),
    loadCommission(user, allowed, filters, showCommission),
  ]);

  return {
    rows: claims.map((c) => toRow(c, commission.byRef, showCommission)),
    total,
    truncated: total > claims.length,
  };
}
