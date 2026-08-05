import type { Prisma, ServiceCode } from "@prisma/client";
import { prisma } from "@/lib/db";
import { creditWallet } from "@/lib/ledger";
import { getEffectiveRate } from "@/lib/scheme/resolver";
import { getEffectiveMdr, type MdrDimensions } from "@/lib/mdr/resolver";
import type { MdrServiceKind } from "@prisma/client";
import { gt, toNumber, dec, round, mul, sub, type Money } from "@/lib/money";
import {
  creditPlatformRevenue,
  creditMdrMargin,
  debitRevenueForCommission,
} from "@/lib/commission/revenue";
import { recordTds } from "@/lib/commission/tds";
import { creditTdsWithheld } from "@/lib/commission/tdsAccount";

/**
 * Flat commission distribution engine (admin-assigned model).
 *
 * After a successful PG/POS/QR transaction, the user earns the commission
 * defined in their admin-assigned scheme — no chain walk, no margins, no
 * multi-tier split. 2% TDS is withheld; the NET is credited to the wallet.
 *
 * Commissions are ONLY distributed for PG, POS, QR transactions. Service
 * transactions (BBPS, Payout, AePS, DMT, Recharge, etc.) do NOT earn
 * commission.
 */

/** Service codes that earn commission (PG/POS/QR only). */
const COMMISSION_ELIGIBLE_SERVICES: ReadonlySet<string> = new Set([
  "PG",
  "POS",
  "QR",
  "UPI_COLLECT",
]);

/** MDR service kinds that earn commission. */
const COMMISSION_ELIGIBLE_MDR: ReadonlySet<string> = new Set([
  "POS",
  "PG",
  "QR",
  "UPI",
]);

/** TDS withheld on every commission payout (2%). */
export const TDS_RATE = 0.02;

/** Split a gross commission into TDS + net at money scale. */
export function applyTds(gross: Money): { tds: Money; net: Money } {
  const tds = round(mul(gross, TDS_RATE));
  return { tds, net: round(sub(gross, tds)) };
}

type CreditResult = {
  userId: string;
  tier: string;
  role: string;
  gross: number;
  tds: number;
  amount: number;
  walletTxnId: string | null;
};

/**
 * Distribute commission for a successful service transaction.
 * Only credits commission if the service is PG/POS/QR eligible.
 * Returns the list of credits applied (single user, no chain).
 */
export async function distributeCommission(
  txnId: string,
  userId: string,
  service: ServiceCode,
  txnAmount: number | Money,
  tx?: Prisma.TransactionClient,
  provider?: string | null
): Promise<CreditResult[]> {
  if (!COMMISSION_ELIGIBLE_SERVICES.has(service)) return [];

  const rate = await getEffectiveRate(userId, service, txnAmount, provider);
  if (rate.source === "NONE" || !gt(rate.commission, 0)) return [];

  const gross = rate.commission;
  const { tds, net } = applyTds(gross);
  if (!gt(net, 0)) return [];

  const baseKey = `commission:${txnId}:${userId}`;
  let walletTxnId: string | null = null;

  try {
    const wtxn = await creditWallet(
      {
        userId,
        amount: net,
        reason: "COMMISSION",
        refType: "Transaction",
        refId: txnId,
        note: `Commission on ${service} txn (gross ₹${gross}, TDS ₹${tds})`,
        idempotencyKey: baseKey,
      },
      tx
    );
    walletTxnId = wtxn.id;
  } catch {
    return [];
  }

  const p = tx ?? prisma;
  const cc = await p.commissionCredit.create({
    data: {
      transactionId: txnId,
      userId,
      tier: "DIRECT",
      amount: net,
      grossAmount: gross,
      tdsAmount: tds,
      walletTxnId,
      schemeId: rate.schemeId,
      service,
      txnAmount: dec(txnAmount),
    },
    select: { id: true },
  });

  // Book the 2% TDS as a liability (filing record) and hold the withheld rupees
  // in the TDS Payable account; the platform keeps charge − gross.
  await recordTds({
    txnId,
    userId,
    service,
    tier: "DIRECT",
    gross,
    tds,
    commissionCreditId: cc.id,
    tx,
  });
  await creditTdsWithheld(txnId, userId, tds, service, tx);

  await creditPlatformRevenue(txnId, service, rate.charge, gross, tx);

  return [
    {
      userId,
      tier: "DIRECT",
      role: "USER",
      gross: toNumber(gross),
      tds: toNumber(tds),
      amount: toNumber(net),
      walletTxnId,
    },
  ];
}

/**
 * Map a ServiceCode to its acquiring MDR rail (null = not an MDR service).
 *
 * Only UPI_COLLECT flows through the generic transaction runner as an acquiring
 * rail; POS/PG/QR captures are settled via their own settlement pipeline
 * (handlePosCapture → distributeMdrCommission) which passes the MdrServiceKind
 * directly.
 */
export function mdrKindForService(service: ServiceCode): MdrServiceKind | null {
  if (service === "UPI_COLLECT") return "UPI";
  return null;
}

/**
 * Walk up to `levels` ancestors of a user via the parent hierarchy.
 * For a retailer: level 1 = DT, level 2 = MD, level 3 = SD.
 */
async function getUplineChain(
  userId: string,
  levels: number,
  tx?: Prisma.TransactionClient
): Promise<string[]> {
  const p = tx ?? prisma;
  const chain: string[] = [];
  let current = userId;
  for (let i = 0; i < levels; i++) {
    const u = await p.user.findUnique({ where: { id: current }, select: { parentId: true } });
    if (!u?.parentId) break;
    chain.push(u.parentId);
    current = u.parentId;
  }
  return chain;
}

/**
 * Distribute MDR-margin commission for a POS/PG/QR/UPI capture (chain model).
 *
 * The company MDR margin (serviceCharge − vendorCharge) is credited to the
 * Revenue Wallet, then upline commissions are paid OUT of that wallet, net of
 * 2% TDS:
 *   - level 1 ancestor (DT) earns commissionDistributor
 *   - level 2 ancestor (MD) earns commissionMaster
 *   - level 3 ancestor (SD) earns commissionSuperDistributor
 * The transacting retailer earns no commission (they get their settlement net
 * of MDR). TDS is routed to the separate TDS liability ledger.
 *
 * Runs inside `tx` when provided so margin-in / commission-out / TDS are atomic.
 */
export async function distributeMdrCommission(
  txnId: string,
  userId: string,
  serviceKind: MdrServiceKind,
  grossAmount: number | Money,
  service: ServiceCode,
  dims: MdrDimensions | string = {},
  tx?: Prisma.TransactionClient
): Promise<CreditResult[]> {
  if (!COMMISSION_ELIGIBLE_MDR.has(serviceKind)) return [];

  const mdr = await getEffectiveMdr(userId, serviceKind, grossAmount, dims);
  if (mdr.source === "NONE") return [];

  // 1. Credit the company MDR margin to the Revenue Wallet (the payout pool).
  const accountId = await creditMdrMargin(txnId, service, mdr.margin, tx);
  // No revenue account → we cannot fund payouts from the wallet; nothing to do.
  if (!accountId) return [];

  // 2. Resolve the upline chain (DT, MD, SD) and each tier's gross commission.
  const chain = await getUplineChain(userId, 3, tx);
  const plan: Array<{ tier: string; recipientId: string | undefined; gross: Money }> = [
    { tier: "DISTRIBUTOR", recipientId: chain[0], gross: mdr.commission.distributor },
    { tier: "MASTER", recipientId: chain[1], gross: mdr.commission.master },
    { tier: "SUPER", recipientId: chain[2], gross: mdr.commission.superDistributor },
  ];

  const p = tx ?? prisma;
  const results: CreditResult[] = [];

  for (const item of plan) {
    if (!item.recipientId) continue;
    if (!gt(item.gross, 0)) continue;
    const { tds, net } = applyTds(item.gross);
    if (!gt(net, 0)) continue;

    let walletTxnId: string | null = null;
    try {
      // Fund the payout by debiting the revenue wallet, then credit the payee.
      await debitRevenueForCommission(accountId, txnId, item.recipientId, item.gross, service, tx);
      const wtxn = await creditWallet(
        {
          userId: item.recipientId,
          amount: net,
          reason: "COMMISSION",
          refType: "Transaction",
          refId: txnId,
          note: `${item.tier} commission on ${serviceKind} (gross ₹${item.gross}, TDS ₹${tds})`,
          idempotencyKey: `commission:${txnId}:${item.recipientId}`,
        },
        tx
      );
      walletTxnId = wtxn.id;
    } catch {
      continue;
    }

    // CommissionCredit record (idempotent: one per txn+payee+tier).
    let commissionCreditId: string | null = null;
    const existingCredit = await p.commissionCredit.findFirst({
      where: { transactionId: txnId, userId: item.recipientId, tier: item.tier },
      select: { id: true },
    });
    if (existingCredit) {
      commissionCreditId = existingCredit.id;
    } else {
      const cc = await p.commissionCredit.create({
        data: {
          transactionId: txnId,
          userId: item.recipientId,
          tier: item.tier,
          amount: net,
          grossAmount: item.gross,
          tdsAmount: tds,
          walletTxnId,
          schemeId: mdr.schemeId,
          service,
          txnAmount: dec(grossAmount),
        },
        select: { id: true },
      });
      commissionCreditId = cc.id;
    }

    // TDS liability ledger (the filing record) + move the withheld rupees into
    // the TDS Payable account so the money is held and remittable. The revenue
    // wallet was debited the GROSS above, so: gross out = net (payee) + tds
    // (TDS account) — money is conserved.
    await recordTds({
      txnId,
      userId: item.recipientId,
      service,
      tier: item.tier,
      gross: item.gross,
      tds,
      commissionCreditId,
      tx,
    });
    await creditTdsWithheld(txnId, item.recipientId, tds, service, tx);

    results.push({
      userId: item.recipientId,
      tier: item.tier,
      role: item.tier,
      gross: toNumber(item.gross),
      tds: toNumber(tds),
      amount: toNumber(net),
      walletTxnId,
    });
  }

  return results;
}
