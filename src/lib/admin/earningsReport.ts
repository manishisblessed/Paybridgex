import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { toNumber } from "@/lib/money";

/**
 * Admin per-transaction EARNINGS report — the platform-owner view of what the
 * company earns on every commission-bearing capture, and exactly how much of
 * the MDR margin is distributed to the network chain (DT / MD / SD).
 *
 * Rail-agnostic: unlike the POS settlement report (driven off PosSettlementEntry,
 * which only exists for POS), this drives off the synthetic/real `Transaction`
 * rows that back commission distribution across ALL acquiring rails:
 *
 *   - POS  → Transaction.refId "POS:<ref>"        (service = POS)
 *   - PG   → Transaction.refId "PG<10>"           (service = WALLET_TOPUP placeholder)
 *   - QR   → Transaction.refId "QR<10>"           (service = WALLET_TOPUP placeholder)
 *   - UPI  → Transaction.service = UPI_COLLECT     (a first-class transaction)
 *
 * Per transaction we surface:
 *   • company MDR margin  — the MDR_MARGIN credit booked to the Revenue Wallet
 *     (serviceCharge − vendor cost) for this txn;
 *   • DT / MD / SD commission — the gross commission distributed to each upline
 *     tier (from CommissionCredit, before 2% TDS);
 *   • platform NET earning — margin − Σ(gross commission), i.e. what the Revenue
 *     Wallet keeps after funding the chain.
 *
 * Access is admin-only (the API guards with requireRole); no downline scoping is
 * applied — the platform owner sees the whole book. An optional `retailerId`
 * narrows to a single transacting user.
 */

/** MDR service rails that distribute chain commission. */
export type EarningsRail = "POS" | "PG" | "QR" | "UPI";

export type EarningsReportFilters = {
  dateFrom: Date;
  dateTo: Date;
  /** Narrow to a single rail (null = all rails). */
  rail?: EarningsRail | null;
  /** Narrow to a single transacting user (the retailer/merchant on the swipe). */
  retailerId?: string | null;
};

export type EarningsReportRetailer = {
  id: string;
  name: string;
  shopName: string | null;
  userCode: string | null;
  role: string;
};

/** A commission recipient at a given tier. */
export type EarningsRecipient = {
  name: string;
  userCode: string | null;
  gross: number;
};

export type EarningsReportRow = {
  transactionId: string;
  refId: string;
  rail: EarningsRail | "OTHER";
  txnTime: string;
  retailer: EarningsReportRetailer | null;
  /** Gross transaction amount (the swipe value). */
  amount: number;
  /** Merchant-facing MDR deducted (from the rail's settlement entry). null when not tracked (QR/UPI). */
  mdrAmount: number | null;
  /** Net amount settled/credited to the merchant. null when not tracked (QR/UPI). */
  netSettled: number | null;
  /** Settlement status (SETTLED / PENDING / FAILED). null when no settlement entry. */
  settlementStatus: string | null;
  /**
   * How many upline ancestors the merchant has (0–3): tier 1 = DT, 2 = MD, 3 = SD.
   * Lets the UI distinguish "no upline at this tier" (—) from "upline exists but
   * earned ₹0" for the commission columns.
   */
  uplineDepth: number;
  /** Company MDR margin booked to the Revenue Wallet for this txn. */
  companyMargin: number;
  /** Gross commission distributed to the Distributor (DT). */
  commDistributor: number;
  /** Gross commission distributed to the Master Distributor (MD). */
  commMaster: number;
  /** Gross commission distributed to the Super Distributor (SD). */
  commSuper: number;
  /** DT + MD + SD gross commission. */
  totalCommission: number;
  /** Platform net earning = companyMargin − totalCommission. */
  platformEarning: number;
  /** Recipient names per tier (null when that tier earned nothing). */
  distributor: EarningsRecipient | null;
  master: EarningsRecipient | null;
  superDistributor: EarningsRecipient | null;
};

export type EarningsRollupRow = {
  userId: string;
  name: string;
  shopName: string | null;
  userCode: string | null;
  role: string;
  txnCount: number;
  amount: number;
  companyMargin: number;
  totalCommission: number;
  platformEarning: number;
};

export type EarningsSummary = {
  totalTransactions: number;
  totalVolume: number;
  totalMdr: number;
  totalSettled: number;
  totalMargin: number;
  totalDistributor: number;
  totalMaster: number;
  totalSuper: number;
  totalCommission: number;
  totalPlatformEarning: number;
};

export type EarningsReportResult = {
  rows: EarningsReportRow[];
  rollup: EarningsRollupRow[];
  summary: EarningsSummary;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasPrev: boolean;
    hasNext: boolean;
  };
  /** True when the working set hit the cap and totals cover only the cap. */
  truncated: boolean;
};

/**
 * Upper bound on the working set. The report loads every matching transaction's
 * ids once (capped) so per-row detail, the rollup, and the summary are all
 * computed over the SAME set. Generous for an admin report; a `truncated` flag
 * signals when a tighter date range is needed for exact totals.
 */
const WORKING_SET_CAP = 20000;

const RAIL_CONDITIONS: Record<EarningsRail, Prisma.TransactionWhereInput> = {
  POS: { refId: { startsWith: "POS:" } },
  PG: { refId: { startsWith: "PG" } },
  QR: { refId: { startsWith: "QR" } },
  UPI: { service: "UPI_COLLECT" },
};

/** Every rail's condition OR-ed together (the "all rails" filter). */
const ALL_RAILS_OR: Prisma.TransactionWhereInput[] = [
  RAIL_CONDITIONS.POS,
  RAIL_CONDITIONS.PG,
  RAIL_CONDITIONS.QR,
  RAIL_CONDITIONS.UPI,
];

function railFor(refId: string, service: string): EarningsRail | "OTHER" {
  if (refId.startsWith("POS:")) return "POS";
  if (refId.startsWith("PG")) return "PG";
  if (refId.startsWith("QR")) return "QR";
  if (service === "UPI_COLLECT") return "UPI";
  return "OTHER";
}

function buildWhere(filters: EarningsReportFilters): Prisma.TransactionWhereInput {
  const where: Prisma.TransactionWhereInput = {
    status: "SUCCESS",
    createdAt: { gte: filters.dateFrom, lte: filters.dateTo },
  };

  if (filters.rail) {
    Object.assign(where, RAIL_CONDITIONS[filters.rail]);
  } else {
    where.OR = ALL_RAILS_OR;
  }

  if (filters.retailerId) where.userId = filters.retailerId;

  return where;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

type SpineTxn = {
  id: string;
  refId: string;
  userId: string;
  service: string;
  partnerTxnId: string | null;
  amount: Prisma.Decimal;
  createdAt: Date;
};

type SettlementInfo = { mdr: number; net: number; status: string };

/**
 * Merchant-facing MDR / net settled / status per transaction, keyed by the
 * partner txn ref (= Transaction.partnerTxnId). Sourced from the POS and PG
 * settlement-entry tables (both carry mdrAmount/netAmount/status). QR/UPI have
 * no equivalent per-txn MDR record, so those rails resolve to null (UI shows —).
 */
async function loadSettlements(partnerRefs: string[]): Promise<Map<string, SettlementInfo>> {
  const map = new Map<string, SettlementInfo>();
  const refs = Array.from(new Set(partnerRefs.filter((r): r is string => Boolean(r))));
  for (const ids of chunk(refs, 1000)) {
    const [pos, pg] = await Promise.all([
      prisma.posSettlementEntry.findMany({
        where: { transactionRef: { in: ids } },
        select: { transactionRef: true, mdrAmount: true, netAmount: true, status: true },
      }),
      prisma.pgSettlementEntry.findMany({
        where: { transactionRef: { in: ids } },
        select: { transactionRef: true, mdrAmount: true, netAmount: true, status: true },
      }),
    ]);
    for (const e of pos) {
      map.set(e.transactionRef, { mdr: toNumber(e.mdrAmount), net: toNumber(e.netAmount), status: e.status });
    }
    for (const e of pg) {
      map.set(e.transactionRef, { mdr: toNumber(e.mdrAmount), net: toNumber(e.netAmount), status: e.status });
    }
  }
  return map;
}

/**
 * Depth of each merchant's upline chain (0–3): how many ancestors exist above
 * them (DT = 1, MD = 2, SD = 3). Batched parent lookups (3 levels) so the report
 * can tell "no upline at this tier" from "upline exists but earned ₹0".
 */
async function loadUplineDepth(retailerIds: string[]): Promise<Map<string, number>> {
  const parentOf = new Map<string, string | null>();
  let frontier = Array.from(new Set(retailerIds));
  for (let level = 0; level < 3 && frontier.length > 0; level++) {
    const need = frontier.filter((id) => !parentOf.has(id));
    if (need.length === 0) break;
    const next: string[] = [];
    for (const ids of chunk(need, 1000)) {
      const rows = await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, parentId: true },
      });
      for (const r of rows) {
        parentOf.set(r.id, r.parentId ?? null);
        if (r.parentId) next.push(r.parentId);
      }
    }
    frontier = next;
  }

  const depthOf = new Map<string, number>();
  for (const id of new Set(retailerIds)) {
    let depth = 0;
    let cur: string | null = id;
    for (let i = 0; i < 3; i++) {
      const p: string | null | undefined = cur ? parentOf.get(cur) : null;
      if (!p) break;
      depth++;
      cur = p;
    }
    depthOf.set(id, depth);
  }
  return depthOf;
}

/** Sum of the REVENUE-book MDR_MARGIN credit per transaction id. */
async function loadMargins(txnIds: string[]): Promise<Map<string, number>> {
  const byTxn = new Map<string, number>();
  for (const ids of chunk(txnIds, 1000)) {
    const rows = await prisma.walletTxn.findMany({
      where: {
        walletType: "REVENUE",
        reason: "MDR_MARGIN",
        refType: "Transaction",
        refId: { in: ids },
      },
      select: { refId: true, amount: true },
    });
    for (const r of rows) {
      if (!r.refId) continue;
      byTxn.set(r.refId, (byTxn.get(r.refId) ?? 0) + toNumber(r.amount));
    }
  }
  return byTxn;
}

type TierSplit = {
  distributor: EarningsRecipient | null;
  master: EarningsRecipient | null;
  superDistributor: EarningsRecipient | null;
};

/** Per-transaction DT/MD/SD gross commission + recipient identity. */
async function loadCommissionSplits(txnIds: string[]): Promise<Map<string, TierSplit>> {
  const byTxn = new Map<string, TierSplit>();
  for (const ids of chunk(txnIds, 1000)) {
    const credits = await prisma.commissionCredit.findMany({
      where: { transactionId: { in: ids } },
      select: {
        transactionId: true,
        tier: true,
        grossAmount: true,
        amount: true,
        user: { select: { name: true, userCode: true } },
      },
    });
    for (const c of credits) {
      const split =
        byTxn.get(c.transactionId) ??
        ({ distributor: null, master: null, superDistributor: null } as TierSplit);
      // grossAmount is nullable on legacy rows — fall back to net `amount`.
      const gross = toNumber(c.grossAmount ?? c.amount);
      const recipient: EarningsRecipient = {
        name: c.user?.name ?? "Unknown",
        userCode: c.user?.userCode ?? null,
        gross,
      };
      if (c.tier === "DISTRIBUTOR") split.distributor = mergeRecipient(split.distributor, recipient);
      else if (c.tier === "MASTER") split.master = mergeRecipient(split.master, recipient);
      else if (c.tier === "SUPER") split.superDistributor = mergeRecipient(split.superDistributor, recipient);
      byTxn.set(c.transactionId, split);
    }
  }
  return byTxn;
}

/** Defensive: if two credits somehow share a tier on one txn, sum the gross. */
function mergeRecipient(
  existing: EarningsRecipient | null,
  next: EarningsRecipient
): EarningsRecipient {
  if (!existing) return next;
  return { ...existing, gross: existing.gross + next.gross };
}

async function loadRetailers(userIds: string[]): Promise<Map<string, EarningsReportRetailer>> {
  const map = new Map<string, EarningsReportRetailer>();
  if (userIds.length === 0) return map;
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, shopName: true, userCode: true, role: true },
  });
  for (const u of users) {
    map.set(u.id, {
      id: u.id,
      name: u.name,
      shopName: u.shopName ?? null,
      userCode: u.userCode ?? null,
      role: u.role,
    });
  }
  return map;
}

function buildRow(
  txn: SpineTxn,
  margins: Map<string, number>,
  splits: Map<string, TierSplit>,
  retailers: Map<string, EarningsReportRetailer>,
  settlements: Map<string, SettlementInfo>,
  depths: Map<string, number>
): EarningsReportRow {
  const split = splits.get(txn.id) ?? {
    distributor: null,
    master: null,
    superDistributor: null,
  };
  const commDistributor = split.distributor?.gross ?? 0;
  const commMaster = split.master?.gross ?? 0;
  const commSuper = split.superDistributor?.gross ?? 0;
  const totalCommission = commDistributor + commMaster + commSuper;
  const companyMargin = margins.get(txn.id) ?? 0;
  const settlement = txn.partnerTxnId ? settlements.get(txn.partnerTxnId) ?? null : null;

  return {
    transactionId: txn.id,
    refId: txn.refId,
    rail: railFor(txn.refId, txn.service),
    txnTime: txn.createdAt.toISOString(),
    retailer: retailers.get(txn.userId) ?? null,
    amount: toNumber(txn.amount),
    mdrAmount: settlement ? settlement.mdr : null,
    netSettled: settlement ? settlement.net : null,
    settlementStatus: settlement ? settlement.status : null,
    uplineDepth: depths.get(txn.userId) ?? 0,
    companyMargin,
    commDistributor,
    commMaster,
    commSuper,
    totalCommission,
    platformEarning: companyMargin - totalCommission,
    distributor: split.distributor,
    master: split.master,
    superDistributor: split.superDistributor,
  };
}

function buildSummary(rows: EarningsReportRow[]): EarningsSummary {
  const s: EarningsSummary = {
    totalTransactions: rows.length,
    totalVolume: 0,
    totalMdr: 0,
    totalSettled: 0,
    totalMargin: 0,
    totalDistributor: 0,
    totalMaster: 0,
    totalSuper: 0,
    totalCommission: 0,
    totalPlatformEarning: 0,
  };
  for (const r of rows) {
    s.totalVolume += r.amount;
    s.totalMdr += r.mdrAmount ?? 0;
    s.totalSettled += r.netSettled ?? 0;
    s.totalMargin += r.companyMargin;
    s.totalDistributor += r.commDistributor;
    s.totalMaster += r.commMaster;
    s.totalSuper += r.commSuper;
    s.totalCommission += r.totalCommission;
    s.totalPlatformEarning += r.platformEarning;
  }
  return s;
}

function buildRollup(rows: EarningsReportRow[]): EarningsRollupRow[] {
  const byUser = new Map<string, EarningsRollupRow>();
  for (const r of rows) {
    if (!r.retailer) continue;
    const u = r.retailer;
    const roll =
      byUser.get(u.id) ??
      ({
        userId: u.id,
        name: u.name,
        shopName: u.shopName,
        userCode: u.userCode,
        role: u.role,
        txnCount: 0,
        amount: 0,
        companyMargin: 0,
        totalCommission: 0,
        platformEarning: 0,
      } as EarningsRollupRow);
    roll.txnCount += 1;
    roll.amount += r.amount;
    roll.companyMargin += r.companyMargin;
    roll.totalCommission += r.totalCommission;
    roll.platformEarning += r.platformEarning;
    byUser.set(u.id, roll);
  }
  return Array.from(byUser.values()).sort((a, b) => b.platformEarning - a.platformEarning);
}

/**
 * Load the full working set of rows (capped), enriched with margin + commission
 * split + retailer identity. Shared by the paged report and the export.
 */
async function loadAllRows(
  filters: EarningsReportFilters
): Promise<{ rows: EarningsReportRow[]; truncated: boolean }> {
  const where = buildWhere(filters);

  const spine = (await prisma.transaction.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: WORKING_SET_CAP + 1,
    select: { id: true, refId: true, userId: true, service: true, partnerTxnId: true, amount: true, createdAt: true },
  })) as SpineTxn[];

  const truncated = spine.length > WORKING_SET_CAP;
  const working = truncated ? spine.slice(0, WORKING_SET_CAP) : spine;

  const txnIds = working.map((t) => t.id);
  const partnerRefs = working.map((t) => t.partnerTxnId).filter((r): r is string => Boolean(r));
  const retailerIds = Array.from(new Set(working.map((t) => t.userId)));
  const [margins, splits, settlements, depths] = await Promise.all([
    loadMargins(txnIds),
    loadCommissionSplits(txnIds),
    loadSettlements(partnerRefs),
    loadUplineDepth(retailerIds),
  ]);
  const retailers = await loadRetailers(retailerIds);

  const rows = working.map((t) => buildRow(t, margins, splits, retailers, settlements, depths));
  return { rows, truncated };
}

/**
 * One page of the earnings report + full-set rollup + summary. All monetary sums
 * cover the FULL matched set (capped), not just the page.
 */
export async function buildEarningsReport(
  filters: EarningsReportFilters,
  page: number,
  pageSize: number
): Promise<EarningsReportResult> {
  const { rows: allRows, truncated } = await loadAllRows(filters);

  const total = allRows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const start = (clampedPage - 1) * pageSize;
  const pageRows = allRows.slice(start, start + pageSize);

  return {
    rows: pageRows,
    rollup: buildRollup(allRows),
    summary: buildSummary(allRows),
    pagination: {
      page: clampedPage,
      pageSize,
      total,
      totalPages,
      hasPrev: clampedPage > 1,
      hasNext: clampedPage < totalPages,
    },
    truncated,
  };
}

/** Every matching row (capped) — backs the CSV/PDF/ZIP export. */
export async function fetchEarningsReportRows(
  filters: EarningsReportFilters
): Promise<{ rows: EarningsReportRow[]; total: number; truncated: boolean }> {
  const { rows, truncated } = await loadAllRows(filters);
  return { rows, total: rows.length, truncated };
}
