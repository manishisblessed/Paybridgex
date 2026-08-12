import type { ServiceCode } from "@prisma/client";
import { prisma } from "@/lib/db";
import { add, dec, toNumber, type Money } from "@/lib/money";
import { istDayBounds } from "./daily";
import { getRevenueAccountId } from "@/lib/commission/revenue";
import { priceScopeLabel } from "@/lib/services/priceScope";

export type ServiceRevenueRow = {
  service: ServiceCode;
  /**
   * Per-product label for BBPS/CC rails (e.g. "Credit Card Bill Payment" vs
   * "Credit Card Bill Payment-2"), sourced from the txn's priceScope. null for
   * services that are not per-product scoped (POS/PG/QR/…, or legacy rows).
   */
  product: string | null;
  txnCount: number;
  totalVolume: number;
  totalCharge: number;
  /** GST collected (pass-through liability, netted out of revenue). */
  gstCollected: number;
  /** Upstream/vendor cost paid on charge-driven rails (BBPS/Payout). */
  vendorCost: number;
  grossCommission: number;
  tdsCollected: number;
  netCommission: number;
  /** (totalCharge − GST) − vendorCost − grossCommission. */
  platformRevenue: number;
};

export type TierCommissionRow = {
  tier: string;
  gross: number;
  tds: number;
  net: number;
  creditCount: number;
};

/**
 * POS company margin split by settlement leg (Instant T+0 vs next-day T+1).
 * `margin` is the MDR margin (service − vendor) credited to the Revenue Wallet;
 * `companyNet` = margin − grossCommission is what the company keeps on that leg.
 */
export type SettlementMarginRow = {
  leg: string;
  settlementType: string | null;
  txnCount: number;
  totalVolume: number;
  margin: number;
  grossCommission: number;
  companyNet: number;
};

export type DailyRevenueRow = {
  date: string;
  txnCount: number;
  totalVolume: number;
  totalCharge: number;
  gstCollected: number;
  vendorCost: number;
  grossCommission: number;
  tdsCollected: number;
  netCommission: number;
  platformRevenue: number;
};

export type RevenueWalletTxn = {
  id: string;
  amount: number;
  direction: "CREDIT" | "DEBIT";
  reason: string;
  balanceAfter: number;
  note: string | null;
  refId: string | null;
  createdAt: string;
};

export type RevenueWallet = {
  accountId: string | null;
  accountName: string | null;
  balance: number;
  creditedInRange: number;
  commissionPaidInRange: number;
  recent: RevenueWalletTxn[];
};

export type RevenueReport = {
  from: string;
  to: string;
  byService: ServiceRevenueRow[];
  byTier: TierCommissionRow[];
  byDay: DailyRevenueRow[];
  posByLeg: SettlementMarginRow[];
  qrByLeg: SettlementMarginRow[];
  wallet: RevenueWallet;
  totals: {
    txnCount: number;
    totalVolume: number;
    totalCharge: number;
    gstCollected: number;
    vendorCost: number;
    grossCommission: number;
    tdsCollected: number;
    netCommission: number;
    platformRevenue: number;
  };
};

export type RevenueReportParams = {
  from?: string | null;
  to?: string | null;
  service?: string | null;
};

export async function getRevenueReport(
  params: RevenueReportParams
): Promise<RevenueReport> {
  const fromBounds = istDayBounds(params.from ?? undefined);
  const toBounds = istDayBounds(params.to ?? params.from ?? undefined);

  const dateStart = fromBounds.dayStart;
  const dateEnd = toBounds.dayEnd;

  const serviceFilter = params.service
    ? { service: params.service as ServiceCode }
    : {};

  const [serviceAgg, commissionByService, commissionByTier, dailyTxns, dailyCommissions] =
    await Promise.all([
      prisma.transaction.groupBy({
        by: ["service", "priceScope"],
        where: {
          status: "SUCCESS",
          createdAt: { gte: dateStart, lte: dateEnd },
          ...serviceFilter,
        },
        _count: { _all: true },
        _sum: { amount: true, fee: true, gst: true, vendorCharge: true },
      }),

      prisma.commissionCredit.groupBy({
        by: ["service"],
        where: {
          createdAt: { gte: dateStart, lte: dateEnd },
          ...serviceFilter,
        },
        _sum: { amount: true, grossAmount: true, tdsAmount: true },
      }),

      prisma.commissionCredit.groupBy({
        by: ["tier"],
        where: {
          createdAt: { gte: dateStart, lte: dateEnd },
          ...serviceFilter,
        },
        _sum: { amount: true, grossAmount: true, tdsAmount: true },
        _count: true,
      }),

      fetchDailyTxns(dateStart, dateEnd, params.service ?? null),

      fetchDailyCommissions(dateStart, dateEnd, params.service ?? null),
    ]);

  const commByServiceMap = new Map(
    commissionByService.map((c) => [
      c.service,
      {
        gross: toNumber(dec(c._sum.grossAmount ?? c._sum.amount ?? 0)),
        tds: toNumber(dec(c._sum.tdsAmount ?? 0)),
        net: toNumber(dec(c._sum.amount ?? 0)),
      },
    ])
  );

  // A service can now split into several product rows (BBPS/CC priceScope). Its
  // commission (keyed by service, and ~0 for charge-driven rails) is attributed
  // to only the FIRST row of that service so per-service totals never double
  // count. Iterate in a deterministic order (service, then null scope first).
  const aggSorted = [...serviceAgg].sort((a, b) => {
    if (a.service !== b.service) return a.service < b.service ? -1 : 1;
    return (a.priceScope ?? "") < (b.priceScope ?? "") ? -1 : (a.priceScope ?? "") > (b.priceScope ?? "") ? 1 : 0;
  });
  const commApplied = new Set<string>();
  const byService: ServiceRevenueRow[] = aggSorted
    .map((s) => {
      const totalCharge = toNumber(dec(s._sum.fee ?? 0));
      const gstCollected = toNumber(dec(s._sum.gst ?? 0));
      const vendorCost = toNumber(dec(s._sum.vendorCharge ?? 0));
      const applyComm = !commApplied.has(s.service);
      if (applyComm) commApplied.add(s.service);
      const comm = (applyComm && commByServiceMap.get(s.service)) || { gross: 0, tds: 0, net: 0 };
      return {
        service: s.service,
        product: priceScopeLabel(s.priceScope),
        txnCount: s._count._all,
        totalVolume: toNumber(dec(s._sum.amount ?? 0)),
        totalCharge,
        gstCollected,
        vendorCost,
        grossCommission: comm.gross,
        tdsCollected: comm.tds,
        netCommission: comm.net,
        platformRevenue: round2(totalCharge - gstCollected - vendorCost - comm.gross),
      };
    })
    .sort((a, b) => b.totalVolume - a.totalVolume);

  // Payouts don't create Transactions — they live on PayoutRequest — so fold a
  // synthetic PAYOUT row in from the successful payouts in range. serviceCharge
  // is pre-GST; present totalCharge GST-inclusive for parity with BBPS (whose
  // Transaction.fee is GST-inclusive). Revenue = serviceCharge − vendor cost.
  const includePayout = !params.service || params.service === "PAYOUT";
  if (includePayout) {
    const payoutAgg = await prisma.payoutRequest.aggregate({
      where: { status: "SUCCESS", completedAt: { gte: dateStart, lte: dateEnd } },
      _count: { _all: true },
      _sum: { amount: true, serviceCharge: true, gst: true, vendorCharge: true },
    });
    if (payoutAgg._count._all > 0) {
      const charge = toNumber(dec(payoutAgg._sum.serviceCharge ?? 0));
      const gstCollected = toNumber(dec(payoutAgg._sum.gst ?? 0));
      const vendorCost = toNumber(dec(payoutAgg._sum.vendorCharge ?? 0));
      byService.push({
        service: "PAYOUT" as ServiceCode,
        product: null,
        txnCount: payoutAgg._count._all,
        totalVolume: toNumber(dec(payoutAgg._sum.amount ?? 0)),
        totalCharge: round2(charge + gstCollected),
        gstCollected,
        vendorCost,
        grossCommission: 0,
        tdsCollected: 0,
        netCommission: 0,
        platformRevenue: round2(charge - vendorCost),
      });
      byService.sort((a, b) => b.totalVolume - a.totalVolume);
    }
  }

  const byTier: TierCommissionRow[] = commissionByTier
    .map((t) => ({
      tier: t.tier,
      gross: toNumber(dec(t._sum.grossAmount ?? t._sum.amount ?? 0)),
      tds: toNumber(dec(t._sum.tdsAmount ?? 0)),
      net: toNumber(dec(t._sum.amount ?? 0)),
      creditCount: t._count,
    }))
    .sort((a, b) => b.net - a.net);

  const dailyCommMap = new Map(
    dailyCommissions.map((d) => [
      d.day,
      {
        gross: parseFloat(d.gross),
        tds: parseFloat(d.tds),
        net: parseFloat(d.net),
      },
    ])
  );

  const byDayMap = new Map<string, DailyRevenueRow>();
  for (const d of dailyTxns) {
    const charge = parseFloat(d.charge);
    const gstCollected = parseFloat(d.gst);
    const vendorCost = parseFloat(d.vendor);
    const comm = dailyCommMap.get(d.day) ?? { gross: 0, tds: 0, net: 0 };
    byDayMap.set(d.day, {
      date: d.day,
      txnCount: Number(d.count),
      totalVolume: parseFloat(d.volume),
      totalCharge: charge,
      gstCollected,
      vendorCost,
      grossCommission: comm.gross,
      tdsCollected: comm.tds,
      netCommission: comm.net,
      platformRevenue: round2(charge - gstCollected - vendorCost - comm.gross),
    });
  }

  // Fold successful payouts (which live on PayoutRequest, not Transaction) into
  // the daily rows — bucketed by completedAt — so byDay reconciles with the
  // payout-inclusive service totals. serviceCharge is ex-GST; present
  // totalCharge GST-inclusive for parity with BBPS. Revenue = charge − vendor.
  if (includePayout) {
    const dailyPayouts = await fetchDailyPayouts(dateStart, dateEnd);
    for (const p of dailyPayouts) {
      const charge = parseFloat(p.charge);
      const gst = parseFloat(p.gst);
      const vendor = parseFloat(p.vendor);
      const existing = byDayMap.get(p.day);
      if (existing) {
        existing.txnCount += Number(p.count);
        existing.totalVolume = round2(existing.totalVolume + parseFloat(p.volume));
        existing.totalCharge = round2(existing.totalCharge + charge + gst);
        existing.gstCollected = round2(existing.gstCollected + gst);
        existing.vendorCost = round2(existing.vendorCost + vendor);
        existing.platformRevenue = round2(existing.platformRevenue + (charge - vendor));
      } else {
        byDayMap.set(p.day, {
          date: p.day,
          txnCount: Number(p.count),
          totalVolume: parseFloat(p.volume),
          totalCharge: round2(charge + gst),
          gstCollected: gst,
          vendorCost: vendor,
          grossCommission: 0,
          tdsCollected: 0,
          netCommission: 0,
          platformRevenue: round2(charge - vendor),
        });
      }
    }
  }

  const byDay: DailyRevenueRow[] = Array.from(byDayMap.values()).sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  );

  const totals = {
    txnCount: byService.reduce((n, r) => n + r.txnCount, 0),
    totalVolume: sumRound(byService.map((r) => r.totalVolume)),
    totalCharge: sumRound(byService.map((r) => r.totalCharge)),
    gstCollected: sumRound(byService.map((r) => r.gstCollected)),
    vendorCost: sumRound(byService.map((r) => r.vendorCost)),
    grossCommission: sumRound(byService.map((r) => r.grossCommission)),
    tdsCollected: sumRound(byService.map((r) => r.tdsCollected)),
    netCommission: sumRound(byService.map((r) => r.netCommission)),
    platformRevenue: sumRound(byService.map((r) => r.platformRevenue)),
  };

  // POS company-margin split by settlement leg. Sourced from the synthetic POS
  // settlement transaction (fee = MDR margin, commission = chain commission),
  // grouped by settlementType. Skipped when a non-POS service filter is active.
  const posLegAgg =
    params.service && params.service !== "POS"
      ? []
      : await prisma.transaction.groupBy({
          by: ["settlementType"],
          where: {
            service: "POS" as ServiceCode,
            status: "SUCCESS",
            createdAt: { gte: dateStart, lte: dateEnd },
          },
          _count: { _all: true },
          _sum: { amount: true, fee: true, commission: true },
        });

  const posByLeg: SettlementMarginRow[] = posLegAgg
    .map((r) => {
      const margin = toNumber(dec(r._sum.fee ?? 0));
      const grossCommission = toNumber(dec(r._sum.commission ?? 0));
      return {
        leg: legLabel(r.settlementType),
        settlementType: r.settlementType,
        txnCount: r._count._all,
        totalVolume: toNumber(dec(r._sum.amount ?? 0)),
        margin,
        grossCommission,
        companyNet: round2(margin - grossCommission),
      };
    })
    .sort((a, b) => b.margin - a.margin);

  // QR company-margin split by settlement leg — the exact QR analogue of
  // posByLeg. Sourced from the synthetic QR settlement transaction (fee = MDR
  // margin, commission = chain commission), grouped by settlementType. Skipped
  // when a non-QR service filter is active.
  const qrLegAgg =
    params.service && params.service !== "QR"
      ? []
      : await prisma.transaction.groupBy({
          by: ["settlementType"],
          where: {
            service: "QR" as ServiceCode,
            status: "SUCCESS",
            createdAt: { gte: dateStart, lte: dateEnd },
          },
          _count: { _all: true },
          _sum: { amount: true, fee: true, commission: true },
        });

  const qrByLeg: SettlementMarginRow[] = qrLegAgg
    .map((r) => {
      const margin = toNumber(dec(r._sum.fee ?? 0));
      const grossCommission = toNumber(dec(r._sum.commission ?? 0));
      return {
        leg: legLabel(r.settlementType),
        settlementType: r.settlementType,
        txnCount: r._count._all,
        totalVolume: toNumber(dec(r._sum.amount ?? 0)),
        margin,
        grossCommission,
        companyNet: round2(margin - grossCommission),
      };
    })
    .sort((a, b) => b.margin - a.margin);

  const wallet = await getRevenueWallet(dateStart, dateEnd);

  return {
    from: fromBounds.ymd,
    to: toBounds.ymd,
    byService,
    byTier,
    byDay,
    posByLeg,
    qrByLeg,
    wallet,
    totals,
  };
}

/** Human label for a settlement leg code. */
function legLabel(settlementType: string | null): string {
  if (settlementType === "T0") return "Instant (T+0)";
  if (settlementType === "T1") return "T+1 (next-day)";
  return "Unspecified";
}

/**
 * The actual revenue-account wallet: current balance, margin credited in the
 * selected window (MDR_MARGIN + SERVICE_MARGIN), commission funded out of it,
 * and the most recent revenue ledger entries.
 */
async function getRevenueWallet(from: Date, to: Date): Promise<RevenueWallet> {
  const accountId = await getRevenueAccountId();
  if (!accountId) {
    return {
      accountId: null,
      accountName: null,
      balance: 0,
      creditedInRange: 0,
      commissionPaidInRange: 0,
      recent: [],
    };
  }

  const [account, marginIn, commissionOut, recent] = await Promise.all([
    prisma.user.findUnique({ where: { id: accountId }, select: { name: true, revenueBalance: true } }),
    prisma.walletTxn.aggregate({
      where: {
        userId: accountId,
        walletType: "REVENUE",
        direction: "CREDIT",
        reason: { in: ["MDR_MARGIN", "SERVICE_MARGIN"] },
        createdAt: { gte: from, lte: to },
      },
      _sum: { amount: true },
    }),
    prisma.walletTxn.aggregate({
      where: {
        userId: accountId,
        walletType: "REVENUE",
        direction: "DEBIT",
        reason: "COMMISSION_PAYOUT",
        createdAt: { gte: from, lte: to },
      },
      _sum: { amount: true },
    }),
    prisma.walletTxn.findMany({
      where: { userId: accountId, walletType: "REVENUE" },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        amount: true,
        direction: true,
        reason: true,
        balanceAfter: true,
        note: true,
        refId: true,
        createdAt: true,
      },
    }),
  ]);

  return {
    accountId,
    accountName: account?.name ?? null,
    balance: toNumber(dec(account?.revenueBalance ?? 0)),
    creditedInRange: toNumber(dec(marginIn._sum.amount ?? 0)),
    commissionPaidInRange: toNumber(dec(commissionOut._sum.amount ?? 0)),
    recent: recent.map((t) => ({
      id: t.id,
      amount: toNumber(dec(t.amount)),
      direction: t.direction,
      reason: t.reason,
      balanceAfter: toNumber(dec(t.balanceAfter)),
      note: t.note,
      refId: t.refId,
      createdAt: t.createdAt.toISOString(),
    })),
  };
}

function sumRound(values: number[]): number {
  let s: Money = dec(0);
  for (const v of values) s = add(s, dec(v));
  return toNumber(s);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type DailyTxnRow = { day: string; count: bigint; volume: string; charge: string; gst: string; vendor: string };
type DailyCommRow = { day: string; gross: string; tds: string; net: string };
type DailyPayoutRow = { day: string; count: bigint; volume: string; charge: string; gst: string; vendor: string };

/**
 * Daily successful-payout aggregates (IST day of completedAt). serviceCharge is
 * ex-GST; gst + vendorCharge are broken out so the caller can net revenue the
 * same way as Transaction rows.
 */
async function fetchDailyPayouts(from: Date, to: Date): Promise<DailyPayoutRow[]> {
  return prisma.$queryRaw<DailyPayoutRow[]>`
    SELECT
      TO_CHAR("completedAt" AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS day,
      COUNT(*)::bigint AS count,
      COALESCE(SUM(amount), 0)::text AS volume,
      COALESCE(SUM("serviceCharge"), 0)::text AS charge,
      COALESCE(SUM(gst), 0)::text AS gst,
      COALESCE(SUM("vendorCharge"), 0)::text AS vendor
    FROM "PayoutRequest"
    WHERE status = 'SUCCESS'
      AND "completedAt" >= ${from}
      AND "completedAt" <= ${to}
    GROUP BY day ORDER BY day
  `;
}

async function fetchDailyTxns(
  from: Date,
  to: Date,
  service: string | null
): Promise<DailyTxnRow[]> {
  if (service) {
    return prisma.$queryRaw<DailyTxnRow[]>`
      SELECT
        TO_CHAR("createdAt" AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS day,
        COUNT(*)::bigint AS count,
        COALESCE(SUM(amount), 0)::text AS volume,
        COALESCE(SUM(fee), 0)::text AS charge,
        COALESCE(SUM(gst), 0)::text AS gst,
        COALESCE(SUM("vendorCharge"), 0)::text AS vendor
      FROM "Transaction"
      WHERE status = 'SUCCESS'
        AND "createdAt" >= ${from}
        AND "createdAt" <= ${to}
        AND service = ${service}::"ServiceCode"
      GROUP BY day ORDER BY day
    `;
  }
  return prisma.$queryRaw<DailyTxnRow[]>`
    SELECT
      TO_CHAR("createdAt" AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS day,
      COUNT(*)::bigint AS count,
      COALESCE(SUM(amount), 0)::text AS volume,
      COALESCE(SUM(fee), 0)::text AS charge,
      COALESCE(SUM(gst), 0)::text AS gst,
      COALESCE(SUM("vendorCharge"), 0)::text AS vendor
    FROM "Transaction"
    WHERE status = 'SUCCESS'
      AND "createdAt" >= ${from}
      AND "createdAt" <= ${to}
    GROUP BY day ORDER BY day
  `;
}

async function fetchDailyCommissions(
  from: Date,
  to: Date,
  service: string | null
): Promise<DailyCommRow[]> {
  if (service) {
    return prisma.$queryRaw<DailyCommRow[]>`
      SELECT
        TO_CHAR("createdAt" AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS day,
        COALESCE(SUM("grossAmount"), 0)::text AS gross,
        COALESCE(SUM("tdsAmount"), 0)::text AS tds,
        COALESCE(SUM(amount), 0)::text AS net
      FROM "CommissionCredit"
      WHERE "createdAt" >= ${from}
        AND "createdAt" <= ${to}
        AND service = ${service}::"ServiceCode"
      GROUP BY day ORDER BY day
    `;
  }
  return prisma.$queryRaw<DailyCommRow[]>`
    SELECT
      TO_CHAR("createdAt" AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS day,
      COALESCE(SUM("grossAmount"), 0)::text AS gross,
      COALESCE(SUM("tdsAmount"), 0)::text AS tds,
      COALESCE(SUM(amount), 0)::text AS net
    FROM "CommissionCredit"
    WHERE "createdAt" >= ${from}
      AND "createdAt" <= ${to}
    GROUP BY day ORDER BY day
  `;
}
