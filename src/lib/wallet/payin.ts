import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { creditWallet } from "@/lib/ledger";
import { getPayinAccountId } from "@/lib/commission/revenue";
import { add, dec, gt, toNumber, type Money } from "@/lib/money";
import { periodStart } from "@/lib/wallet/aggregates";

/**
 * Company PAYIN monitoring wallet.
 *
 * Every live inbound — POS capture, PG collection, QR settlement, wallet
 * top-up — mirrors its GROSS amount into the PAYIN book on the platform-owner
 * account (the oldest MASTER_ADMIN, same account that holds REVENUE). This is a
 * pure real-time BUSINESS MONITOR: master-admin can see how much money is
 * flowing through each rail right now.
 *
 * It is credit-only (never debited) and best-effort: a failure to mirror must
 * NEVER block or roll back the underlying settlement. The `payin:<rail>:<refId>`
 * idempotency key guarantees a given inbound is counted at most once, even under
 * webhook retries / cron replays.
 */

/** The live-inbound rails the payin wallet tracks. */
export type PayinRail = "POS" | "PG" | "QR" | "TOPUP";

/** Map a PAYIN WalletTxn.refType back to its rail (only recordPayin writes this book). */
const RAIL_BY_REF_TYPE: Record<string, PayinRail> = {
  PosTransactionMirror: "POS", // POS payin now mirrors the RAW captured feed (matches the POS Fleet volume)
  PosSettlementEntry: "POS", // legacy: earlier POS payin was recorded at the settlement point
  PgSettlementEntry: "PG",
  QrClaim: "QR",
  Transaction: "TOPUP",
};

const RAIL_ORDER: PayinRail[] = ["POS", "PG", "QR", "TOPUP"];

const RAIL_LABEL: Record<PayinRail | "OTHER", string> = {
  POS: "POS",
  PG: "Payment Gateway",
  QR: "QR",
  TOPUP: "Wallet Top-up",
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

/**
 * Live payin rollup for the master-admin dashboard: lifetime balance plus a
 * per-rail (POS / PG / QR / Top-up) count + gross for the selected period.
 */
export async function getPayinSummary(period: PayinPeriod): Promise<PayinSummary> {
  const accountId = await getPayinAccountId();
  const since = periodStart(period);
  const asOf = new Date().toISOString();

  const baseRails = (): Map<PayinRail | "OTHER", PayinRailStat> =>
    new Map(RAIL_ORDER.map((r) => [r, { rail: r, label: RAIL_LABEL[r], count: 0, amount: 0 }]));

  if (!accountId) {
    return {
      accountId: null,
      balance: 0,
      period,
      since: since.toISOString(),
      totalCount: 0,
      totalAmount: 0,
      rails: Array.from(baseRails().values()),
      asOf,
    };
  }

  const [account, grouped] = await Promise.all([
    prisma.user.findUnique({ where: { id: accountId }, select: { payinBalance: true } }),
    prisma.walletTxn.groupBy({
      by: ["refType"],
      where: {
        userId: accountId,
        walletType: "PAYIN",
        direction: "CREDIT",
        createdAt: { gte: since },
      },
      _sum: { amount: true },
      _count: true,
    }),
  ]);

  const statByRail = baseRails();
  let totalCount = 0;
  let totalAmount: Money = dec(0);

  for (const g of grouped) {
    const rail: PayinRail | "OTHER" = (g.refType && RAIL_BY_REF_TYPE[g.refType]) || "OTHER";
    const amount = dec(g._sum.amount ?? 0);
    const existing =
      statByRail.get(rail) ?? { rail, label: RAIL_LABEL[rail], count: 0, amount: 0 };
    existing.count += g._count;
    existing.amount = toNumber(add(dec(existing.amount), amount));
    statByRail.set(rail, existing);
    totalCount += g._count;
    totalAmount = add(totalAmount, amount);
  }

  return {
    accountId,
    balance: toNumber(dec(account?.payinBalance ?? 0)),
    period,
    since: since.toISOString(),
    totalCount,
    totalAmount: toNumber(totalAmount),
    rails: Array.from(statByRail.values()),
    asOf,
  };
}
