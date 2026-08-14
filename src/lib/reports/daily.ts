/**
 * Daily user report aggregator (Primary wallet).
 *
 * For every user in scope, computes on a single IST calendar day:
 *   opening balance  → last WalletTxn.balanceAfter (PRIMARY) before dayStart
 *   credits          → grouped by WalletReason (TOPUP, COMMISSION, REVERSAL, …)
 *   debits by service→ grouped from Transaction.service where status=SUCCESS
 *                      (DISPLAY ONLY — this omits fee/GST, so it must not drive
 *                      the recon math)
 *   other debits     → PAYOUT / PARENT_PULL / PENALTY / FEE from WalletTxn
 *   push             → admin/parent money moved INTO the wallet today
 *                      (PARENT_PUSH credits + admin WalletOperation PUSH). A
 *                      subset of Σcredits, surfaced as its own column.
 *   pull             → admin/parent money moved OUT of the wallet today
 *                      (PARENT_PULL debits + admin WalletOperation PULL). A
 *                      subset of Σdebits, surfaced as its own column.
 *   commission       → grouped from CommissionCredit by service (gross / TDS / net)
 *   closing balance  → last WalletTxn.balanceAfter (PRIMARY) at or before dayEnd
 *
 * Reconciliation invariant per row:
 *   opening + Σcredits − Σdebits ≡ closing
 * Because push ⊆ Σcredits and pull ⊆ Σdebits, this is equivalent to the
 * push/pull-explicit form the UI renders:
 *   opening + (credits − push) + push − (debits − pull) − pull ≡ closing
 * Both Σcredits and Σdebits are taken from the WalletTxn LEDGER (the same source
 * as opening/closing), so the delta is a TRUE integrity canary: it stays ~0
 * unless a balanceAfter chain genuinely drifts, and never trips merely because
 * a service charged a fee. (The per-service Transaction breakdown is display.)
 *
 * All queries are grouped/aggregated in the DB against existing indexes; user
 * data is stitched in memory. Never loops per-user against the DB.
 */

import { Prisma, type ServiceCode } from "@prisma/client";
import { prisma } from "@/lib/db";
import { add, dec, sub, toNumber, type Money } from "@/lib/money";

/* ── date helpers ─────────────────────────────────────────────────── */

/**
 * Turn a YYYY-MM-DD (or ISO date) into the [start, end) window that
 * corresponds to that IST calendar day, expressed in UTC.
 *
 * IST is a fixed UTC+05:30 offset (no DST), so a naive offset-shift is
 * safe here — no timezone library required.
 */
export function istDayBounds(dateInput?: string | Date | null): {
  dayStart: Date;
  dayEnd: Date;
  ymd: string; // human-readable YYYY-MM-DD in IST
} {
  const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

  // Anchor "now" or the caller's date in IST first.
  const raw =
    dateInput instanceof Date
      ? dateInput
      : dateInput
      ? new Date(String(dateInput).length === 10 ? `${dateInput}T00:00:00.000+05:30` : dateInput)
      : new Date();

  const istMs = raw.getTime() + IST_OFFSET_MS;
  const istDate = new Date(istMs);
  const y = istDate.getUTCFullYear();
  const m = istDate.getUTCMonth();
  const d = istDate.getUTCDate();
  const ymd = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  // 00:00 IST → subtract offset back to UTC.
  const dayStart = new Date(Date.UTC(y, m, d, 0, 0, 0, 0) - IST_OFFSET_MS);
  // 24:00 IST (exclusive upper) — for lte we clip to 23:59:59.999.
  const dayEnd = new Date(Date.UTC(y, m, d, 23, 59, 59, 999) - IST_OFFSET_MS);
  return { dayStart, dayEnd, ymd };
}

/* ── types ────────────────────────────────────────────────────────── */

export type CreditsBreakdown = {
  topup: number;
  commission: number;
  reversal: number;
  parentPush: number;
  posSettle: number;
  adjustment: number;
  fundTransferIn: number;
  other: number;
  total: number;
};

export type OtherDebitsBreakdown = {
  payout: number;
  parentPull: number;
  penalty: number;
  fee: number;
  withdraw: number;
  fundTransferOut: number;
  adjustment: number;
  other: number;
  total: number;
};

export type ServiceDebitRow = {
  service: ServiceCode;
  txns: number;
  amount: number;
  fee: number;
  gst: number;
};

export type ServiceCommissionRow = {
  service: ServiceCode;
  gross: number;
  tds: number;
  net: number;
};

export type DailyUserRow = {
  userId: string;
  name: string;
  code: string | null;   // shopName / user code
  email: string | null;
  role: string;
  opening: number;
  credits: CreditsBreakdown;
  debitsByService: ServiceDebitRow[];
  otherDebits: OtherDebitsBreakdown;
  commissionByService: ServiceCommissionRow[];
  totalDebits: number;
  totalCommission: number;   // net commission (already inside credits.commission)
  /** Admin/parent money pushed INTO the wallet today (⊆ credits.total). */
  push: number;
  /** Admin/parent money pulled OUT of the wallet today (⊆ totalDebits). */
  pull: number;
  closing: number;
  reconDelta: number;        // closing − (opening + credits.total − totalDebits)
};

export type DailyReportParams = {
  date?: string | Date | null;   // IST YYYY-MM-DD; defaults to today (IST)
  userIds: string[] | null;      // null = every user (admin scope)
  role?: string | null;          // filter by exact Role
  service?: string | null;       // restrict debitsByService to a single service
  q?: string | null;             // name / email / shopName / id fuzzy search
  page?: number;
  pageSize?: number;
  /** When true, ignore page/pageSize and return every matching user (capped). */
  forExport?: boolean;
};

export type DailyReport = {
  date: string;                  // IST YYYY-MM-DD
  dayStart: string;              // ISO
  dayEnd: string;                // ISO
  rows: DailyUserRow[];
  total: number;
  page: number;
  pageSize: number;
  totals: {
    opening: number;
    creditsTotal: number;
    debitsTotal: number;
    push: number;
    pull: number;
    commissionNet: number;
    closing: number;
  };
  services: ServiceCode[];       // union of services seen this day (for UI filter)
};

/* ── constants ────────────────────────────────────────────────────── */

/** Every role we surface user-money rows for. Staff roles are excluded. */
const NETWORK_ROLES = [
  "RETAILER",
  "DISTRIBUTOR",
  "MASTER_DISTRIBUTOR",
  "SUPER_DISTRIBUTOR",
] as const;

const EXPORT_ROW_CAP = 2_000;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 200;

/* ── main entry ───────────────────────────────────────────────────── */

export async function getDailyUserReport(params: DailyReportParams): Promise<DailyReport> {
  const { dayStart, dayEnd, ymd } = istDayBounds(params.date ?? undefined);
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize ?? DEFAULT_PAGE_SIZE));

  // Role/scope where clause — used for both the paginated user page and
  // the totals count. Staff roles are always filtered out.
  const roleFilter =
    params.role && (NETWORK_ROLES as readonly string[]).includes(params.role)
      ? params.role
      : undefined;

  const userWhere: Prisma.UserWhereInput = {
    deletedAt: null,
    ...(params.userIds ? { id: { in: params.userIds } } : {}),
    role: roleFilter
      ? (roleFilter as (typeof NETWORK_ROLES)[number])
      : { in: [...NETWORK_ROLES] },
    ...(params.q
      ? {
          OR: [
            { name: { contains: params.q, mode: "insensitive" as const } },
            { email: { contains: params.q, mode: "insensitive" as const } },
            { shopName: { contains: params.q, mode: "insensitive" as const } },
            { phone: { contains: params.q } },
            { id: { contains: params.q } },
          ],
        }
      : {}),
  };

  const skip = (page - 1) * pageSize;
  const take = params.forExport ? EXPORT_ROW_CAP : pageSize;

  // 1) The user page for the current filter — sorted deterministically so
  //    pagination is stable across days.
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where: userWhere,
      select: {
        id: true,
        name: true,
        email: true,
        shopName: true,
        role: true,
      },
      orderBy: [{ role: "asc" }, { name: "asc" }, { id: "asc" }],
      skip: params.forExport ? 0 : skip,
      take,
    }),
    prisma.user.count({ where: userWhere }),
  ]);

  const userIds = users.map((u) => u.id);

  // Early-exit: page has no users, nothing else to fetch.
  if (userIds.length === 0) {
    return {
      date: ymd,
      dayStart: dayStart.toISOString(),
      dayEnd: dayEnd.toISOString(),
      rows: [],
      total,
      page,
      pageSize,
      totals: {
        opening: 0,
        creditsTotal: 0,
        debitsTotal: 0,
        push: 0,
        pull: 0,
        commissionNet: 0,
        closing: 0,
      },
      services: [],
    };
  }

  // 2..7) Fire every aggregate query in parallel — none of them depend on
  //       each other, so the wall-clock is one Postgres round-trip.
  const [
    openingRows,
    closingRows,
    creditsGrouped,
    debitsGrouped,
    commissionGrouped,
    otherDebitsGrouped,
    serviceLedgerDebitGrouped,
    walletOpGrouped,
  ] =
    await Promise.all([
      lastBalancesBefore(userIds, dayStart),
      lastBalancesAtOrBefore(userIds, dayEnd),
      prisma.walletTxn.groupBy({
        by: ["userId", "reason"],
        where: {
          userId: { in: userIds },
          walletType: "PRIMARY",
          direction: "CREDIT",
          createdAt: { gte: dayStart, lte: dayEnd },
        },
        _sum: { amount: true },
      }),
      // Service-wise debits come from the *service* table so we naturally
      // ignore ledger rows that aren't service-attributable.
      prisma.transaction.groupBy({
        by: ["userId", "service"],
        where: {
          userId: { in: userIds },
          status: "SUCCESS",
          createdAt: { gte: dayStart, lte: dayEnd },
          ...(params.service ? { service: params.service as ServiceCode } : {}),
        },
        _sum: { amount: true, fee: true, gst: true },
        _count: { _all: true },
      }),
      prisma.commissionCredit.groupBy({
        by: ["userId", "service"],
        where: {
          userId: { in: userIds },
          createdAt: { gte: dayStart, lte: dayEnd },
          ...(params.service ? { service: params.service as ServiceCode } : {}),
        },
        _sum: { amount: true, grossAmount: true, tdsAmount: true },
      }),
      // Non-service debits from the ledger: PAYOUT / PARENT_PULL / PENALTY /
      // FEE / WITHDRAW / FUND_TRANSFER_OUT / ADJUSTMENT. Reason=TRANSACTION
      // is excluded because those are already captured by the service group.
      prisma.walletTxn.groupBy({
        by: ["userId", "reason"],
        where: {
          userId: { in: userIds },
          walletType: "PRIMARY",
          direction: "DEBIT",
          reason: { notIn: ["TRANSACTION"] },
          createdAt: { gte: dayStart, lte: dayEnd },
        },
        _sum: { amount: true },
      }),
      // Actual wallet debit for service transactions (reason=TRANSACTION). This
      // is the reserved `amount + fee` written by the service handler — the
      // authoritative money movement — so reconciliation matches the ledger
      // exactly (the per-service Transaction breakdown below is display-only and
      // omits fee/GST, which is why it must NOT drive the recon math).
      prisma.walletTxn.groupBy({
        by: ["userId"],
        where: {
          userId: { in: userIds },
          walletType: "PRIMARY",
          direction: "DEBIT",
          reason: "TRANSACTION",
          createdAt: { gte: dayStart, lte: dayEnd },
        },
        _sum: { amount: true },
      }),
      // Admin wallet operations ("admin push/pull to wallet") land in the ledger
      // as reason=ADJUSTMENT with refType=WalletOperation — a PUSH is a CREDIT,
      // a PULL is a DEBIT. Group by direction so we can surface push (in) and
      // pull (out) as their own columns, extracted from the generic
      // credits/debits buckets. Parent-network transfers (PARENT_PUSH /
      // PARENT_PULL) are folded in separately below.
      prisma.walletTxn.groupBy({
        by: ["userId", "direction"],
        where: {
          userId: { in: userIds },
          walletType: "PRIMARY",
          refType: "WalletOperation",
          createdAt: { gte: dayStart, lte: dayEnd },
        },
        _sum: { amount: true },
      }),
    ]);

  // Build index maps for O(users) stitching.
  const openingByUser = new Map(openingRows.map((r) => [r.userId, r.balanceAfter]));
  const closingByUser = new Map(closingRows.map((r) => [r.userId, r.balanceAfter]));

  // Authoritative service wallet debit (reason=TRANSACTION) per user — used for
  // the reconciliation math so it ties out to the ledger, not the fee-excluding
  // Transaction table.
  const serviceLedgerDebitByUser = new Map(
    serviceLedgerDebitGrouped.map((r) => [r.userId, toNumber(dec(r._sum.amount ?? 0))])
  );

  // Admin wallet-op push (CREDIT) / pull (DEBIT) per user, keyed off refType.
  const adminPushByUser = new Map<string, number>();
  const adminPullByUser = new Map<string, number>();
  for (const g of walletOpGrouped) {
    const amt = toNumber(dec(g._sum.amount ?? 0));
    if (g.direction === "CREDIT")
      adminPushByUser.set(g.userId, (adminPushByUser.get(g.userId) ?? 0) + amt);
    else adminPullByUser.set(g.userId, (adminPullByUser.get(g.userId) ?? 0) + amt);
  }

  const creditsByUser = new Map<string, CreditsBreakdown>();
  for (const g of creditsGrouped) {
    const b = creditsByUser.get(g.userId) ?? emptyCredits();
    const amt = toNumber(dec(g._sum.amount ?? 0));
    switch (g.reason) {
      case "TOPUP":            b.topup += amt; break;
      case "COMMISSION":       b.commission += amt; break;
      case "REVERSAL":         b.reversal += amt; break;
      case "PARENT_PUSH":      b.parentPush += amt; break;
      case "POS_SETTLEMENT":   b.posSettle += amt; break;
      case "ADJUSTMENT":       b.adjustment += amt; break;
      case "FUND_TRANSFER_IN": b.fundTransferIn += amt; break;
      default:                 b.other += amt; break;
    }
    b.total += amt;
    creditsByUser.set(g.userId, b);
  }

  const otherDebitsByUser = new Map<string, OtherDebitsBreakdown>();
  for (const g of otherDebitsGrouped) {
    const b = otherDebitsByUser.get(g.userId) ?? emptyOtherDebits();
    const amt = toNumber(dec(g._sum.amount ?? 0));
    switch (g.reason) {
      case "PAYOUT":            b.payout += amt; break;
      case "PARENT_PULL":       b.parentPull += amt; break;
      case "PENALTY":           b.penalty += amt; break;
      case "FEE":               b.fee += amt; break;
      case "WITHDRAW":          b.withdraw += amt; break;
      case "FUND_TRANSFER_OUT": b.fundTransferOut += amt; break;
      case "ADJUSTMENT":        b.adjustment += amt; break;
      default:                  b.other += amt; break;
    }
    b.total += amt;
    otherDebitsByUser.set(g.userId, b);
  }

  const debitsByUser = new Map<string, ServiceDebitRow[]>();
  const serviceSet = new Set<ServiceCode>();
  for (const g of debitsGrouped) {
    const arr = debitsByUser.get(g.userId) ?? [];
    arr.push({
      service: g.service,
      txns: g._count._all,
      amount: toNumber(dec(g._sum.amount ?? 0)),
      fee: toNumber(dec(g._sum.fee ?? 0)),
      gst: toNumber(dec(g._sum.gst ?? 0)),
    });
    debitsByUser.set(g.userId, arr);
    serviceSet.add(g.service);
  }

  const commissionByUser = new Map<string, ServiceCommissionRow[]>();
  for (const g of commissionGrouped) {
    const arr = commissionByUser.get(g.userId) ?? [];
    arr.push({
      service: g.service,
      gross: toNumber(dec(g._sum.grossAmount ?? g._sum.amount ?? 0)),
      tds: toNumber(dec(g._sum.tdsAmount ?? 0)),
      net: toNumber(dec(g._sum.amount ?? 0)),
    });
    commissionByUser.set(g.userId, arr);
    serviceSet.add(g.service);
  }

  // Stitch — one row per user in the current page.
  const rows: DailyUserRow[] = users.map((u) => {
    const openingD: Money = dec(openingByUser.get(u.id) ?? 0);
    const credits = creditsByUser.get(u.id) ?? emptyCredits();
    const otherDebits = otherDebitsByUser.get(u.id) ?? emptyOtherDebits();
    const serviceDebits = (debitsByUser.get(u.id) ?? []).sort((a, b) => b.amount - a.amount);
    const commissionRows = (commissionByUser.get(u.id) ?? []).sort((a, b) => b.net - a.net);

    // Total debits from the LEDGER (authoritative money movement): the
    // service wallet debit (reason=TRANSACTION, which is amount + fee) plus the
    // non-service ledger debits. Driving recon from the ledger — the same
    // source as opening/closing/credits — makes the delta a true integrity
    // canary (it only fires on genuine balanceAfter drift), instead of falsely
    // flagging the fee/GST the display breakdown omits.
    const serviceLedgerDebit = serviceLedgerDebitByUser.get(u.id) ?? 0;
    const totalDebits = toNumber(add(dec(serviceLedgerDebit), dec(otherDebits.total)));

    // Push (money moved IN by admin/parent) = parent-network push + admin
    // wallet-op push; Pull (money moved OUT) = parent-network pull + admin
    // wallet-op pull. Both are subsets of the ledger credits/debits above, so
    // the closing recon is unchanged — we're only re-bucketing for display.
    const push = toNumber(add(dec(credits.parentPush), dec(adminPushByUser.get(u.id) ?? 0)));
    const pull = toNumber(add(dec(otherDebits.parentPull), dec(adminPullByUser.get(u.id) ?? 0)));

    // Closing preference: authoritative ledger value if we saw activity,
    // else opening (user was quiet today).
    const closingD: Money = dec(closingByUser.get(u.id) ?? openingD);

    const expected = add(sub(openingD, dec(totalDebits)), dec(credits.total));
    const reconDelta = toNumber(sub(closingD, expected));

    const totalCommission = commissionRows.reduce((n, r) => n + r.net, 0);

    return {
      userId: u.id,
      name: u.name,
      code: u.shopName,
      email: u.email,
      role: u.role,
      opening: toNumber(openingD),
      credits,
      debitsByService: serviceDebits,
      otherDebits,
      commissionByService: commissionRows,
      totalDebits,
      totalCommission,
      push,
      pull,
      closing: toNumber(closingD),
      reconDelta,
    };
  });

  // Filter-in-place if a service filter is active and the user had zero
  // matching debits *and* zero matching commission — that user isn't
  // meaningful in the "used in service X" cut.
  const filtered = params.service
    ? rows.filter((r) => r.debitsByService.length > 0 || r.commissionByService.length > 0)
    : rows;

  // Page totals — computed after the optional service filter.
  const totals = {
    opening: sumRound(filtered.map((r) => r.opening)),
    creditsTotal: sumRound(filtered.map((r) => r.credits.total)),
    debitsTotal: sumRound(filtered.map((r) => r.totalDebits)),
    push: sumRound(filtered.map((r) => r.push)),
    pull: sumRound(filtered.map((r) => r.pull)),
    commissionNet: sumRound(filtered.map((r) => r.totalCommission)),
    closing: sumRound(filtered.map((r) => r.closing)),
  };

  return {
    date: ymd,
    dayStart: dayStart.toISOString(),
    dayEnd: dayEnd.toISOString(),
    rows: filtered,
    total,
    page,
    pageSize,
    totals,
    services: [...serviceSet].sort(),
  };
}

/* ── helpers ──────────────────────────────────────────────────────── */

function emptyCredits(): CreditsBreakdown {
  return {
    topup: 0,
    commission: 0,
    reversal: 0,
    parentPush: 0,
    posSettle: 0,
    adjustment: 0,
    fundTransferIn: 0,
    other: 0,
    total: 0,
  };
}

function emptyOtherDebits(): OtherDebitsBreakdown {
  return {
    payout: 0,
    parentPull: 0,
    penalty: 0,
    fee: 0,
    withdraw: 0,
    fundTransferOut: 0,
    adjustment: 0,
    other: 0,
    total: 0,
  };
}

/** Sum an array with Decimal precision, then return a JS number. */
function sumRound(values: number[]): number {
  let s = dec(0);
  for (const v of values) s = add(s, dec(v));
  return toNumber(s);
}

/**
 * Last PRIMARY ledger balance for every user, strictly before `before`.
 * Uses DISTINCT ON so we get exactly one row per user in a single scan.
 */
async function lastBalancesBefore(userIds: string[], before: Date) {
  if (userIds.length === 0) return [] as { userId: string; balanceAfter: Prisma.Decimal }[];
  return prisma.$queryRaw<{ userId: string; balanceAfter: Prisma.Decimal }[]>`
    SELECT DISTINCT ON ("userId") "userId", "balanceAfter"
    FROM "WalletTxn"
    WHERE "userId" = ANY(${userIds})
      AND "walletType" = 'PRIMARY'
      AND "createdAt" < ${before}
    ORDER BY "userId", "createdAt" DESC, "id" DESC
  `;
}

/**
 * Last PRIMARY ledger balance for every user at or before `at` — that's
 * the closing balance for the window.
 */
async function lastBalancesAtOrBefore(userIds: string[], at: Date) {
  if (userIds.length === 0) return [] as { userId: string; balanceAfter: Prisma.Decimal }[];
  return prisma.$queryRaw<{ userId: string; balanceAfter: Prisma.Decimal }[]>`
    SELECT DISTINCT ON ("userId") "userId", "balanceAfter"
    FROM "WalletTxn"
    WHERE "userId" = ANY(${userIds})
      AND "walletType" = 'PRIMARY'
      AND "createdAt" <= ${at}
    ORDER BY "userId", "createdAt" DESC, "id" DESC
  `;
}
