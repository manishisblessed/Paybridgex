import { NextResponse } from "next/server";
import { Prisma, type ServiceCode } from "@prisma/client";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { dec, toNumber } from "@/lib/money";
import { istDayBounds } from "@/lib/reports/daily";
import {
  addServiceTotals,
  classifyPayout,
  classifyPg,
  classifyPos,
  classifyQr,
  classifyTxn,
  emptyServiceToday,
  normalize,
  round2,
  summarize,
  type Bucket,
  type ServiceToday,
} from "@/lib/dashboard/rails";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * Hierarchical "Network Business Overview" — lets a distributor tier see the
 * transaction activity of the entities directly under them, with each direct
 * child's row rolling up that child's ENTIRE subtree (because only retailers,
 * the leaves, actually transact):
 *
 *   SUPER_DISTRIBUTOR  → per Master Distributor  (their whole subtree)
 *   MASTER_DISTRIBUTOR → per Distributor         (their whole subtree)
 *   DISTRIBUTOR        → per Retailer             (the retailer's own activity)
 *
 * "All rails" are counted, each from its own source of truth so nothing is
 * double-counted:
 *   Transaction (isSettlement=false, real user services) → recharge / DMT / AEPS
 *     / BBPS / UPI collect / travel …  grouped per ServiceCode
 *   PosSettlementEntry → POS       PgSettlementEntry → PG       QrClaim → QR
 *   PayoutRequest      → Payout (an OUTFLOW; reported on its own, never folded
 *                        into transaction turnover)
 *
 * Money follows the app convention: the headline rupee figure is COMPLETED
 * business only (success/settled); counts cover every status. "Today" defaults
 * to the current IST business day; a from/to range picker is supported.
 *
 * Access: SUPER_DISTRIBUTOR / MASTER_DISTRIBUTOR / DISTRIBUTOR only. Scope is
 * strictly the caller's own downline (recursive CTE seeded from their direct
 * children), so a distributor can never see outside their network.
 */

const NETWORK_OVERVIEW_ROLES = new Set([
  "SUPER_DISTRIBUTOR",
  "MASTER_DISTRIBUTOR",
  "DISTRIBUTOR",
]);

const CHILD_LABEL: Record<string, string> = {
  SUPER_DISTRIBUTOR: "master distributors",
  MASTER_DISTRIBUTOR: "distributors",
  DISTRIBUTOR: "retailers",
};

const LEVEL_SLUG: Record<string, string> = {
  SUPER_DISTRIBUTOR: "super-distributor",
  MASTER_DISTRIBUTOR: "master-distributor",
  DISTRIBUTOR: "distributor",
};

/**
 * Transaction service codes to EXCLUDE from the "transaction rail" so no rail is
 * double-counted: POS/QR settle via their own tables (synthetic Transaction rows
 * for those carry isSettlement=true, already filtered out — these guard real
 * rows too), and payouts / wallet funding are not commerce turnover.
 */
const EXCLUDED_TXN_SERVICES = [
  "PAYOUT",
  "UPI_PAYOUT",
  "WALLET_TOPUP",
  "WALLET_WITHDRAW",
  "POS",
  "QR",
] as unknown as ServiceCode[];

type MemberAgg = {
  count: number;
  success: number;
  pending: number;
  failed: number;
  volume: number;
  commission: number;
};

const emptyMember = (): MemberAgg => ({
  count: 0,
  success: 0,
  pending: 0,
  failed: 0,
  volume: 0,
  commission: 0,
});

type UserStatusRow = {
  userId: string;
  status: string;
  _count: number;
  _sum: Record<string, unknown>;
};

/** Attribute a rail's per-user rows onto the direct child each user rolls up to. */
function foldRailIntoMembers(
  rows: UserStatusRow[],
  amountField: string,
  classify: (s: string) => Bucket,
  members: Map<string, MemberAgg>,
  rootOf: Map<string, string>,
  commissionField?: string
): void {
  for (const r of rows) {
    const root = rootOf.get(r.userId);
    if (!root) continue;
    const m = members.get(root);
    if (!m) continue;
    const bucket = classify(String(r.status));
    const cnt = typeof r._count === "number" ? r._count : 0;
    m.count += cnt;
    m[bucket] += cnt;
    if (bucket === "success") {
      m.volume = round2(m.volume + toNumber(dec((r._sum?.[amountField] as never) ?? 0)));
      if (commissionField) {
        m.commission = round2(
          m.commission + toNumber(dec((r._sum?.[commissionField] as never) ?? 0))
        );
      }
    }
  }
}

function displayRole(r: string): string {
  return LEVEL_SLUG[r] ?? r.toLowerCase();
}

function displayStatus(s: string): string {
  const map: Record<string, string> = {
    ACTIVE: "Active",
    PENDING_KYC: "Pending KYC",
    SUSPENDED: "Suspended",
    CLOSED: "Closed",
  };
  return map[s] ?? s;
}

/** Title-case a ServiceCode enum value: RECHARGE_MOBILE → "Recharge Mobile". */
function serviceLabel(service: string): string {
  return service
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

export async function GET(req: Request) {
  let user;
  try {
    user = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  if (!NETWORK_OVERVIEW_ROLES.has(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const today = istDayBounds();
    const fromYmd = searchParams.get("from") || today.ymd;
    const toYmd = searchParams.get("to") || today.ymd;
    const dayStart = istDayBounds(fromYmd).dayStart;
    const dayEnd = istDayBounds(toYmd).dayEnd;
    const range = { gte: dayStart, lte: dayEnd };
    // POS/PG bucket by the real capture time (falls back to createdAt on legacy
    // rows), matching the settlement crons and the platform overview.
    const capturedRange = {
      OR: [{ capturedAt: range }, { capturedAt: null, createdAt: range }],
    };

    const childLabel = CHILD_LABEL[user.role] ?? "members";
    const level = LEVEL_SLUG[user.role] ?? user.role.toLowerCase();

    // Direct children (the rows), plus a recursive map of every descendant to the
    // direct child it rolls up under.
    const [directChildren, treeRows] = await Promise.all([
      prisma.user.findMany({
        where: { parentId: user.id, deletedAt: null },
        select: {
          id: true,
          userCode: true,
          name: true,
          role: true,
          status: true,
          shopName: true,
          city: true,
          state: true,
          walletBalance: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.$queryRaw<{ id: string; rootChildId: string }[]>`
        WITH RECURSIVE tree AS (
          SELECT id, id AS "rootChildId"
          FROM "User"
          WHERE "parentId" = ${user.id} AND "deletedAt" IS NULL
          UNION ALL
          SELECT u.id, t."rootChildId"
          FROM "User" u
          INNER JOIN tree t ON u."parentId" = t.id
          WHERE u."deletedAt" IS NULL
        )
        SELECT id, "rootChildId" FROM tree
      `,
    ]);

    const rootOf = new Map(treeRows.map((r) => [r.id, r.rootChildId]));
    const scopedIds = treeRows.map((r) => r.id);

    // No downline yet — return an empty-but-well-formed payload.
    if (scopedIds.length === 0) {
      return NextResponse.json({
        level,
        childLabel,
        range: { from: fromYmd, to: toYmd },
        summary: {
          totalTransactions: 0,
          successCount: 0,
          pendingCount: 0,
          failedCount: 0,
          totalVolume: 0,
          totalCommission: 0,
          totalMembers: directChildren.length,
          activeMembers: 0,
          payout: emptyServiceToday(),
        },
        serviceBreakdown: [],
        members: [],
      });
    }

    const scopeFilter = { userId: { in: scopedIds } };

    const [txnByUser, txnByService, posByUser, pgByUser, qrByUser, payoutRows] =
      await Promise.all([
        prisma.transaction.groupBy({
          by: ["userId", "status"],
          where: {
            ...scopeFilter,
            isSettlement: false,
            service: { notIn: EXCLUDED_TXN_SERVICES },
            createdAt: range,
          },
          _count: true,
          _sum: { amount: true, commission: true },
        }),
        prisma.transaction.groupBy({
          by: ["service", "status"],
          where: {
            ...scopeFilter,
            isSettlement: false,
            service: { notIn: EXCLUDED_TXN_SERVICES },
            createdAt: range,
          },
          _count: true,
          _sum: { amount: true },
        }),
        prisma.posSettlementEntry.groupBy({
          by: ["userId", "status"],
          where: { ...scopeFilter, ...capturedRange },
          _count: true,
          _sum: { grossAmount: true },
        }),
        prisma.pgSettlementEntry.groupBy({
          by: ["userId", "status"],
          where: { ...scopeFilter, ...capturedRange },
          _count: true,
          _sum: { grossAmount: true },
        }),
        prisma.qrClaim.groupBy({
          by: ["userId", "status"],
          where: { ...scopeFilter, createdAt: range },
          _count: true,
          _sum: { amount: true },
        }),
        prisma.payoutRequest.groupBy({
          by: ["status"],
          where: { ...scopeFilter, createdAt: range },
          _count: true,
          _sum: { amount: true },
        }),
      ]);

    // ── Per-member rollup (subtree attributed to each direct child) ──
    const members = new Map<string, MemberAgg>();
    for (const c of directChildren) members.set(c.id, emptyMember());

    foldRailIntoMembers(txnByUser as never, "amount", classifyTxn, members, rootOf, "commission");
    foldRailIntoMembers(posByUser as never, "grossAmount", classifyPos, members, rootOf);
    foldRailIntoMembers(pgByUser as never, "grossAmount", classifyPg, members, rootOf);
    foldRailIntoMembers(qrByUser as never, "amount", classifyQr, members, rootOf);

    const memberRows = directChildren
      .map((c) => {
        const m = members.get(c.id) ?? emptyMember();
        return {
          id: c.id,
          userCode: c.userCode,
          name: c.name,
          shop: c.shopName ?? "—",
          role: displayRole(c.role),
          city: c.city ?? "—",
          state: c.state ?? "—",
          status: displayStatus(c.status),
          walletBalance: Number(c.walletBalance),
          txnCount: m.count,
          successCount: m.success,
          pendingCount: m.pending,
          failedCount: m.failed,
          volume: round2(m.volume),
          commission: round2(m.commission),
        };
      })
      .sort((a, b) => b.volume - a.volume || b.txnCount - a.txnCount);

    const activeMembers = memberRows.filter((m) => m.successCount > 0).length;

    // ── Service-wise breakdown (transaction rail per ServiceCode + POS/PG/QR) ──
    const serviceRows = new Map<string, UserStatusRow[]>();
    for (const r of txnByService as Array<{ service: string; status: string; _count: number; _sum: Record<string, unknown> }>) {
      const key = String(r.service);
      const arr = serviceRows.get(key) ?? [];
      arr.push({ userId: "", status: String(r.status), _count: r._count, _sum: r._sum });
      serviceRows.set(key, arr);
    }

    const breakdown: Array<{ service: string; label: string } & ServiceToday> = [];
    for (const [service, rows] of serviceRows) {
      const st = summarize(normalize(rows as never, "amount"), classifyTxn);
      if (st.count > 0) breakdown.push({ service, label: serviceLabel(service), ...st });
    }
    const pos = summarize(normalize(posByUser as never, "grossAmount"), classifyPos);
    const pg = summarize(normalize(pgByUser as never, "grossAmount"), classifyPg);
    const qr = summarize(normalize(qrByUser as never, "amount"), classifyQr);
    if (pos.count > 0) breakdown.push({ service: "POS", label: "POS", ...pos });
    if (pg.count > 0) breakdown.push({ service: "PG", label: "Payment Gateway", ...pg });
    if (qr.count > 0) breakdown.push({ service: "QR", label: "QR Collections", ...qr });
    breakdown.sort((a, b) => b.amount - a.amount || b.count - a.count);

    const totals = addServiceTotals(breakdown);
    const payout = summarize(normalize(payoutRows as never, "amount"), classifyPayout);
    const totalCommission = round2(memberRows.reduce((s, m) => s + m.commission, 0));

    return NextResponse.json({
      level,
      childLabel,
      range: { from: fromYmd, to: toYmd },
      summary: {
        totalTransactions: totals.count,
        successCount: totals.success,
        pendingCount: totals.pending,
        failedCount: totals.failed,
        totalVolume: totals.amount,
        totalCommission,
        totalMembers: directChildren.length,
        activeMembers,
        payout,
      },
      serviceBreakdown: breakdown,
      members: memberRows,
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError || e instanceof Error) {
      console.error("[dashboard/network-overview] GET error:", e);
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
