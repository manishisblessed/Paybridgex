import { QrClaimStatus, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { creditWallet } from "@/lib/ledger";
import { getPayinAccountId } from "@/lib/commission/revenue";
import { add, dec, gt, toNumber, type Money } from "@/lib/money";

/**
 * Company PAYIN monitoring wallet.
 *
 * Every live ACQUIRING inbound — POS capture, PG collection, QR settlement —
 * mirrors its GROSS amount into the PAYIN book on the platform-owner account
 * (the oldest MASTER_ADMIN, same account that holds REVENUE). This is a pure
 * real-time BUSINESS MONITOR: master-admin can see how much money is flowing
 * through each acquiring rail right now.
 *
 * NOTE: wallet top-ups are deliberately EXCLUDED — a top-up is an agent loading
 * their own wallet (a liability we owe them), not company acquiring business, so
 * it must never inflate the payin monitor.
 *
 * It is credit-only (never debited) and best-effort: a failure to mirror must
 * NEVER block or roll back the underlying settlement. The `payin:<rail>:<refId>`
 * idempotency key guarantees a given inbound is counted at most once, even under
 * webhook retries / cron replays.
 */

/** The live acquiring-inbound rails the payin wallet tracks (no wallet top-ups). */
export type PayinRail = "POS" | "PG" | "QR";

const RAIL_LABEL: Record<PayinRail | "OTHER", string> = {
  POS: "POS",
  PG: "Payment Gateway",
  QR: "QR",
  OTHER: "Other",
};

/**
 * Mirror a live inbound's GROSS amount into the company payin wallet.
 *
 * Best-effort: swallows all errors (monitoring must never break settlement) and
 * runs in its OWN transaction — callers pass `tx` only when they explicitly want
 * it atomic with the caller's transaction (rare; a failed credit inside a shared
 * tx would abort it, so the default standalone path is preferred).
 */
export async function recordPayin(input: {
  rail: PayinRail;
  grossAmount: Money | number | string;
  refType: string;
  refId: string;
  note?: string;
  tx?: Prisma.TransactionClient;
}): Promise<void> {
  if (!gt(dec(input.grossAmount), 0)) return;
  try {
    const accountId = await getPayinAccountId(input.tx);
    if (!accountId) return;
    await creditWallet(
      {
        userId: accountId,
        amount: input.grossAmount,
        reason: "PAYIN_COLLECTION",
        walletType: "PAYIN",
        refType: input.refType,
        refId: input.refId,
        note: input.note ?? `[${input.rail}] live payin`,
        idempotencyKey: `payin:${input.rail.toLowerCase()}:${input.refId}`,
      },
      input.tx
    );
  } catch {
    // Best-effort monitoring mirror — never block the underlying settlement.
  }
}

export type PayinPeriod = "today" | "week" | "month" | "year";

export type PayinRailStat = {
  rail: PayinRail | "OTHER";
  label: string;
  count: number;
  amount: number;
};

export type PayinSummary = {
  accountId: string | null;
  /** Lifetime gross mirrored into the payin wallet (the PAYIN book balance). */
  balance: number;
  period: PayinPeriod;
  since: string;
  /** Inbound count within the selected period. */
  totalCount: number;
  /** Gross inbound within the selected period. */
  totalAmount: number;
  rails: PayinRailStat[];
  asOf: string;
};

/** Start of the CURRENT IST period, as a UTC Date. Uses the SAME day boundary
 *  the POS Fleet uses so figures match the operational feeds and reset cleanly
 *  at IST midnight (today → 12:00 AM IST, week → Monday, month/year → the 1st). */
function istPeriodStart(period: PayinPeriod, now = new Date()): Date {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const year = ist.getUTCFullYear();
  let month = ist.getUTCMonth();
  let day = ist.getUTCDate();
  switch (period) {
    case "today":
      break;
    case "week":
      day -= (ist.getUTCDay() + 6) % 7; // Monday-based week
      break;
    case "month":
      day = 1;
      break;
    case "year":
      month = 0;
      day = 1;
      break;
  }
  return new Date(Date.UTC(year, month, day) - 5.5 * 60 * 60 * 1000);
}

/**
 * Per-rail gross + count read from each rail's SOURCE table, optionally windowed
 * to `since` (omit for all-time). This is the single source the live payin
 * monitor reads, so every payin surface matches the operational feeds exactly:
 * POS ← captured `PosTransactionMirror` (identical to the POS Fleet volume),
 * PG ← `PgSettlementEntry`, QR ← non-rejected `QrClaim`. Wallet top-ups are NOT
 * counted (they are agent liabilities, not company acquiring business). No
 * PAYIN-ledger dependency → no forward-only lag.
 */
async function aggregateRailsFromSource(since?: Date): Promise<PayinRailStat[]> {
  const window = since ? { gte: since } : undefined;
  const [pos, pg, qr] = await Promise.all([
    prisma.posTransactionMirror.aggregate({
      where: { status: "CAPTURED", ...(window ? { txnTime: window } : {}) },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.pgSettlementEntry.aggregate({
      where: { status: { not: "FAILED" }, ...(window ? { createdAt: window } : {}) },
      _sum: { grossAmount: true },
      _count: true,
    }),
    prisma.qrClaim.aggregate({
      where: {
        status: { notIn: [QrClaimStatus.REJECTED, QrClaimStatus.CLAWED_BACK] },
        ...(window ? { createdAt: window } : {}),
      },
      _sum: { amount: true },
      _count: true,
    }),
  ]);
  return [
    { rail: "POS", label: RAIL_LABEL.POS, count: pos._count, amount: toNumber(dec(pos._sum.amount ?? 0)) },
    { rail: "PG", label: RAIL_LABEL.PG, count: pg._count, amount: toNumber(dec(pg._sum.grossAmount ?? 0)) },
    { rail: "QR", label: RAIL_LABEL.QR, count: qr._count, amount: toNumber(dec(qr._sum.amount ?? 0)) },
  ];
}

function sumRails(rails: PayinRailStat[]): { count: number; amount: Money } {
  let count = 0;
  let amount: Money = dec(0);
  for (const r of rails) {
    count += r.count;
    amount = add(amount, dec(r.amount));
  }
  return { count, amount };
}

/**
 * Live payin rollup for the master-admin dashboard: per-rail (POS / PG / QR /
 * Top-up) count + gross for the selected period, plus the all-time total — ALL
 * computed from the rail sources (not the PAYIN ledger), so the tab matches the
 * POS Fleet and the top-bar Payin chip exactly, with no forward-only lag.
 */
export async function getPayinSummary(period: PayinPeriod): Promise<PayinSummary> {
  const accountId = await getPayinAccountId();
  const since = istPeriodStart(period);
  const asOf = new Date().toISOString();

  const [rails, allTime] = await Promise.all([
    aggregateRailsFromSource(since),
    aggregateRailsFromSource(),
  ]);

  const { count: totalCount, amount: totalAmount } = sumRails(rails);
  const { amount: balance } = sumRails(allTime);

  return {
    accountId,
    balance: toNumber(balance),
    period,
    since: since.toISOString(),
    totalCount,
    totalAmount: toNumber(totalAmount),
    rails,
    asOf,
  };
}

export type LivePayinToday = {
  since: string;
  asOf: string;
  totalCount: number;
  totalAmount: number;
  rails: PayinRailStat[];
};

/**
 * TODAY's live business per rail — the exact same source-driven numbers as
 * `getPayinSummary("today")`, surfaced for the master-admin's top-bar "Payin"
 * chip. Resets to ₹0 at IST midnight (the window starts at the IST day).
 */
export async function getLivePayinToday(): Promise<LivePayinToday> {
  const since = istPeriodStart("today");
  const asOf = new Date().toISOString();
  const rails = await aggregateRailsFromSource(since);
  const { count: totalCount, amount: totalAmount } = sumRails(rails);
  return { since: since.toISOString(), asOf, totalCount, totalAmount: toNumber(totalAmount), rails };
}

export type TopupUserRow = {
  userId: string;
  userCode: string | null;
  name: string;
  shopName: string | null;
  role: string;
  count: number;
  amount: number;
  /** ISO timestamp of this user's most recent top-up in the window. */
  lastAt: string;
};

export type TopupTxnRow = {
  refId: string;
  userId: string;
  userCode: string | null;
  name: string;
  shopName: string | null;
  amount: number;
  partner: string | null;
  createdAt: string;
};

export type TopupsByUser = {
  period: PayinPeriod;
  since: string;
  asOf: string;
  totalCount: number;
  totalAmount: number;
  /** Per-user rollup, highest amount first. */
  byUser: TopupUserRow[];
  /** The individual top-up transactions (most recent first, capped). */
  rows: TopupTxnRow[];
};

/**
 * "Which top-up, and to which user" — the GENUINE wallet top-ups in the selected
 * period (IST window), grouped by user and also listed per transaction. Filtered
 * to real top-ups (refId `TOPUP…`) so the PG/QR commission placeholders that
 * reuse the WALLET_TOPUP service code are excluded. Read-only monitor view.
 */
export async function getTopupsByUser(period: PayinPeriod): Promise<TopupsByUser> {
  const since = istPeriodStart(period);
  const asOf = new Date().toISOString();

  const txns = await prisma.transaction.findMany({
    where: {
      service: "WALLET_TOPUP",
      status: "SUCCESS",
      refId: { startsWith: "TOPUP" },
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: 1000,
    select: {
      refId: true,
      userId: true,
      amount: true,
      partner: true,
      createdAt: true,
      user: { select: { userCode: true, name: true, shopName: true, role: true } },
    },
  });

  const byUserMap = new Map<string, TopupUserRow & { _amount: Money }>();
  const rows: TopupTxnRow[] = [];
  let total = dec(0);

  for (const t of txns) {
    const amt = toNumber(dec(t.amount));
    total = add(total, dec(t.amount));
    rows.push({
      refId: t.refId,
      userId: t.userId,
      userCode: t.user?.userCode ?? null,
      name: t.user?.name ?? "Unknown",
      shopName: t.user?.shopName ?? null,
      amount: amt,
      partner: t.partner ?? null,
      createdAt: t.createdAt.toISOString(),
    });

    const existing = byUserMap.get(t.userId);
    if (existing) {
      existing.count += 1;
      existing._amount = add(existing._amount, dec(t.amount));
      // rows are DESC by createdAt, so the first seen is already the latest.
    } else {
      byUserMap.set(t.userId, {
        userId: t.userId,
        userCode: t.user?.userCode ?? null,
        name: t.user?.name ?? "Unknown",
        shopName: t.user?.shopName ?? null,
        role: t.user?.role ?? "—",
        count: 1,
        amount: 0,
        lastAt: t.createdAt.toISOString(),
        _amount: dec(t.amount),
      });
    }
  }

  const byUser: TopupUserRow[] = Array.from(byUserMap.values())
    .map(({ _amount, ...u }) => ({ ...u, amount: toNumber(_amount) }))
    .sort((a, b) => b.amount - a.amount);

  return {
    period,
    since: since.toISOString(),
    asOf,
    totalCount: txns.length,
    totalAmount: toNumber(total),
    byUser,
    rows,
  };
}
