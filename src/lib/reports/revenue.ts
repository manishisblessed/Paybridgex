import type { ServiceCode } from "@prisma/client";
import { prisma } from "@/lib/db";
import { add, dec, toNumber, type Money } from "@/lib/money";
import { istDayBounds } from "./daily";
import { getRevenueAccountId } from "@/lib/commission/revenue";

export type ServiceRevenueRow = {
  service: ServiceCode;
  txnCount: number;
  totalVolume: number;
  totalCharge: number;
  grossCommission: number;
  tdsCollected: number;
  netCommission: number;
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
  wallet: RevenueWallet;
  totals: {
    txnCount: number;
    totalVolume: number;
    totalCharge: number;
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
        by: ["service"],
        where: {
          status: "SUCCESS",
          createdAt: { gte: dateStart, lte: dateEnd },
          ...serviceFilter,
        },
        _count: { _all: true },
        _sum: { amount: true, fee: true },
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

  const byService: ServiceRevenueRow[] = serviceAgg
    .map((s) => {
      const totalCharge = toNumber(dec(s._sum.fee ?? 0));
      const comm = commByServiceMap.get(s.service) ?? {
        gross: 0,
        tds: 0,
        net: 0,
      };
      return {
        service: s.service,
        txnCount: s._count._all,
        totalVolume: toNumber(dec(s._sum.amount ?? 0)),
        totalCharge,
        grossCommission: comm.gross,
        tdsCollected: comm.tds,
        netCommission: comm.net,
        platformRevenue: round2(totalCharge - comm.gross),
      };
    })
    .sort((a, b) => b.totalVolume - a.totalVolume);

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

  const byDay: DailyRevenueRow[] = dailyTxns.map((d) => {
    const charge = parseFloat(d.charge);
    const comm = dailyCommMap.get(d.day) ?? { gross: 0, tds: 0, net: 0 };
    return {
      date: d.day,
      txnCount: Number(d.count),
      totalVolume: parseFloat(d.volume),
      totalCharge: charge,
      grossCommission: comm.gross,
      tdsCollected: comm.tds,
      netCommission: comm.net,
      platformRevenue: round2(charge - comm.gross),
    };
  });

  const totals = {
    txnCount: byService.reduce((n, r) => n + r.txnCount, 0),
    totalVolume: sumRound(byService.map((r) => r.totalVolume)),
    totalCharge: sumRound(byService.map((r) => r.totalCharge)),
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

  const wallet = await getRevenueWallet(dateStart, dateEnd);

  return {
    from: fromBounds.ymd,
    to: toBounds.ymd,
    byService,
    byTier,
    byDay,
    posByLeg,
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
 * The actual revenue-account wallet: current balance, PLATFORM_REVENUE credited
 * in the selected window, and the most recent revenue ledger entries.
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
        reason: "MDR_MARGIN",
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

type DailyTxnRow = { day: string; count: bigint; volume: string; charge: string };
type DailyCommRow = { day: string; gross: string; tds: string; net: string };

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
        COALESCE(SUM(fee), 0)::text AS charge
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
      COALESCE(SUM(fee), 0)::text AS charge
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
