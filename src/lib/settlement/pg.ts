import { prisma } from "@/lib/db";
import { creditWallet } from "@/lib/ledger";
import { distributeMdrCommission } from "@/lib/commission/distribute";
import { railScopeKey } from "@/lib/mdr/floor";
import { dec, gte, gt, round, toNumber } from "@/lib/money";
import { recordPayin } from "@/lib/wallet/payin";
import { getSetting } from "@/lib/settings";
import {
  priceSchemeSettlement,
  startOfTodayIst,
  SETTLED_VIA,
  type SettledVia,
} from "@/lib/settlement/engine";
import type { MdrServiceKind, ServiceCode } from "@prisma/client";

/**
 * PG (payment gateway) acquirer settlement engine — the scheme-priced analogue
 * of the POS engine (src/lib/settlement/pos.ts).
 *
 * A hosted-checkout / UPI-collect payment is CONFIRMED (provider webhook or
 * status poll) and handed to `handlePgCapture`. MDR is priced against the
 * retailer's ASSIGNED SCHEME (PG slab) via `priceSchemeSettlement`, which also
 * re-verifies the acquirer cost against the provider's live rail rate card
 * (RailMdrRate) so a collection is never settled below cost. The NET is credited
 * to the retailer:
 *   - INSTANT: credited synchronously on confirmation.
 *   - T+1:     queued PENDING and swept by the daily worker cron
 *              (QUEUES.PG_SETTLEMENT_T1) at the configured IST hour; only
 *              captures from previous IST days are due (true T+1).
 *
 * Upline MDR-margin commission is distributed at confirmation (mirrors POS),
 * funded from the company margin (scheme MDR − acquirer cost).
 */

export type PgCaptureInput = {
  /** Provider's unique txn/order reference (idempotency key). */
  transactionRef: string;
  /** Provider order id, for audit / support lookups. */
  orderId?: string;
  /** Retailer who owns the collection (resolved by the caller/webhook). */
  userId: string;
  grossAmount: number;
  /** UPI | CARD | NETBANKING | WALLET. Defaults to UPI. */
  paymentMode?: string;
  /**
   * Rail scopeKey the acquirer cost is priced against (e.g. RAZORPAY / BULKPE).
   * Defaults to the enabled PG ServiceRoute provider.
   */
  provider?: string | null;
  /** When the customer actually paid. Defaults to now. */
  capturedAt?: Date | string;
};

export type PgCaptureResult = {
  status: "SETTLED" | "QUEUED" | "DUPLICATE" | "SKIPPED" | "NO_SCHEME";
  netAmount?: number;
  mdrAmount?: number;
  mode?: string;
};

/**
 * Decide whether a PG collection settles instantly or T+1:
 *   1. user.instantSettlement = true → INSTANT (per-user override)
 *   2. else follow the global default (settlement.pg_instant.defaultEnabled).
 */
async function resolvePgSettlementMode(userInstant: boolean): Promise<"INSTANT" | "T1"> {
  if (userInstant) return "INSTANT";
  const globalInstant = await getSetting("settlement.pg_instant");
  return globalInstant.defaultEnabled ? "INSTANT" : "T1";
}

export async function handlePgCapture(input: PgCaptureInput): Promise<PgCaptureResult> {
  // Idempotency — if we already processed this confirmation, skip.
  const existing = await prisma.pgSettlementEntry.findUnique({
    where: { transactionRef: input.transactionRef },
  });
  if (existing) return { status: "DUPLICATE" };

  // Only ACTIVE retailers settle.
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { instantSettlement: true, status: true },
  });
  if (!user || user.status !== "ACTIVE") return { status: "SKIPPED" };

  const paymentMode = input.paymentMode ?? "UPI";
  const scopeKey = input.provider ?? (await railScopeKey("PG"));

  const mode = await resolvePgSettlementMode(user.instantSettlement);
  const settlementType = mode === "INSTANT" ? "T0" : "T1";

  // Price MDR against the assigned scheme (with the rail acquirer-cost guard).
  // Refuse to settle unpriced money — park nothing; simply report NO_SCHEME so
  // the caller can retry once admin configures the scheme/rate.
  const price = await priceSchemeSettlement({
    userId: input.userId,
    serviceKind: "PG",
    grossAmount: input.grossAmount,
    paymentMode,
    settlementType,
    scopeKey,
  });
  if (!price) return { status: "NO_SCHEME" };

  const netAmount = round(price.netAmount);
  if (!gt(netAmount, 0)) return { status: "SKIPPED" };

  // Mirror the GROSS into the company payin wallet (best-effort live monitor),
  // once per confirmation — regardless of instant vs T+1 settlement.
  await recordPayin({
    rail: "PG",
    grossAmount: input.grossAmount,
    refType: "PgSettlementEntry",
    refId: input.transactionRef,
    note: `PG payin (${paymentMode})`,
  });

  const capturedAt = input.capturedAt ? new Date(input.capturedAt) : new Date();
  const capturedAtValid = !Number.isNaN(capturedAt.getTime());

  if (mode === "INSTANT") {
    // Credit now; if the credit fails mid-flight, park a PENDING/INSTANT entry
    // for the instant safety-net cron to retry. The pg-settle:<ref> ledger key
    // guarantees the retailer is never credited twice.
    let wtxnId: string | null = null;
    try {
      const wtxn = await creditWallet({
        userId: input.userId,
        amount: netAmount,
        reason: "SETTLEMENT",
        refType: "PgSettlementEntry",
        refId: input.transactionRef,
        note: `PG instant settlement (${paymentMode})`,
        idempotencyKey: `pg-settle:${input.transactionRef}`,
      });
      wtxnId = wtxn.id;
    } catch {
      wtxnId = null;
    }

    await prisma.pgSettlementEntry.create({
      data: {
        transactionRef: input.transactionRef,
        orderId: input.orderId ?? null,
        userId: input.userId,
        grossAmount: dec(input.grossAmount),
        mdrAmount: round(price.mdrAmount),
        netAmount,
        vendorAmount: price.vendorAmount ?? null,
        mode: "INSTANT",
        status: wtxnId ? "SETTLED" : "PENDING",
        settledAt: wtxnId ? new Date() : null,
        settledVia: wtxnId ? SETTLED_VIA.INSTANT_AUTO : null,
        walletTxnId: wtxnId,
        paymentMode,
        provider: scopeKey,
        schemeId: price.schemeId,
        slabId: price.slabId,
        vendorRateId: price.vendorRateId,
        capturedAt: capturedAtValid ? capturedAt : null,
      },
    });

    // Book company margin + upline commission ONLY when actually settled now
    // (wtxnId set) — INSTANT credit IS the settlement moment. A parked entry is
    // settled later by the instant safety-net cron (settlePgEntry), which
    // distributes commission then; so commission/revenue always land AT
    // settlement, never at capture. Never fail an already-credited settlement.
    if (wtxnId) {
      try {
        await distributeCommissionForPg(input.transactionRef, input.userId, input.grossAmount, paymentMode, settlementType);
      } catch (e) {
        console.error("[pg capture] instant commission distribution failed:", input.transactionRef, e);
      }
    }

    return {
      status: wtxnId ? "SETTLED" : "QUEUED",
      netAmount: toNumber(netAmount),
      mdrAmount: toNumber(price.mdrAmount),
      mode: "INSTANT",
    };
  }

  // T+1 — queue for the daily cron. MDR is re-verified at sweep time.
  await prisma.pgSettlementEntry.create({
    data: {
      transactionRef: input.transactionRef,
      orderId: input.orderId ?? null,
      userId: input.userId,
      grossAmount: dec(input.grossAmount),
      mdrAmount: round(price.mdrAmount),
      netAmount,
      vendorAmount: price.vendorAmount ?? null,
      mode: "T1",
      status: "PENDING",
      paymentMode,
      provider: scopeKey,
      schemeId: price.schemeId,
      slabId: price.slabId,
      vendorRateId: price.vendorRateId,
      capturedAt: capturedAtValid ? capturedAt : null,
    },
  });

  // Commission + revenue margin are NOT booked here — they are distributed when
  // the entry is actually settled (settlePgEntry), so the Revenue Wallet and the
  // upline are credited AT settlement time, never at capture.

  return {
    status: "QUEUED",
    netAmount: toNumber(netAmount),
    mdrAmount: toNumber(price.mdrAmount),
    mode: "T1",
  };
}

/**
 * PG commission distribution (chain model): the company MDR margin
 * (serviceCharge − vendorCharge) funds upline commissions net of 2% TDS, exactly
 * like POS. Creates a placeholder Transaction for the CommissionCredit FK (there
 * is no ServiceCode for PG settlement — reuse WALLET_TOPUP as POS does), then
 * distributes via the MDR chain. Idempotent per capture via the unique refId.
 */
async function distributeCommissionForPg(
  transactionRef: string,
  userId: string,
  grossAmount: number,
  paymentMode: string,
  settlementType: "T0" | "T1" = "T1"
) {
  const refId = `PG${transactionRef.slice(-10).toUpperCase()}`;
  let txn = await prisma.transaction.findUnique({ where: { refId } });
  if (!txn) {
    txn = await prisma.transaction.create({
      data: {
        refId,
        userId,
        service: "WALLET_TOPUP" as ServiceCode, // PG settlement has no ServiceCode; placeholder (matches POS)
        amount: dec(grossAmount),
        status: "SUCCESS",
        partner: "PG",
        partnerTxnId: transactionRef,
        // Inbound acquirer settlement anchor — excluded from risk/AML (see schema).
        isSettlement: true,
      },
    });
  }

  await distributeMdrCommission(txn.id, userId, "PG" as MdrServiceKind, grossAmount, txn.service, {
    paymentMode,
    settlementType,
  });
}

type PendingPgEntry = {
  id: string;
  transactionRef: string;
  userId: string;
  grossAmount: unknown;
  mdrAmount: unknown;
  netAmount: unknown;
  paymentMode: string | null;
  provider: string | null;
};

/**
 * Settle a single PENDING entry and credit the retailer wallet. The MDR is
 * RE-PRICED against the current scheme + rail rate at settlement time (rates may
 * have moved since capture), so the net credited always reflects live pricing.
 * Returns the net credited, or null when it can't be settled (leave PENDING).
 */
async function settlePgEntry(
  entry: PendingPgEntry,
  settlementType: "T0" | "T1",
  via: SettledVia
): Promise<number | null> {
  const price = await priceSchemeSettlement({
    userId: entry.userId,
    serviceKind: "PG",
    grossAmount: toNumber(entry.grossAmount as never),
    paymentMode: entry.paymentMode ?? "UPI",
    settlementType,
    scopeKey: entry.provider,
  });
  if (!price) return null; // no scheme rate / below floor / below acquirer cost — leave PENDING

  const netAmount = round(price.netAmount);
  if (!gt(netAmount, 0)) return null;

  const wtxn = await creditWallet({
    userId: entry.userId,
    amount: netAmount,
    reason: "SETTLEMENT",
    refType: "PgSettlementEntry",
    refId: entry.id,
    note: `PG ${settlementType === "T0" ? "instant" : "T+1"} settlement (${entry.paymentMode ?? "UPI"})`,
    idempotencyKey: `pg-settle:${entry.transactionRef}`,
  });

  await prisma.pgSettlementEntry.update({
    where: { id: entry.id },
    data: {
      status: "SETTLED",
      settledAt: new Date(),
      walletTxnId: wtxn.id,
      settledVia: via,
      mdrAmount: round(price.mdrAmount),
      netAmount,
      vendorAmount: price.vendorAmount ?? null,
      vendorRateId: price.vendorRateId,
      schemeId: price.schemeId,
      slabId: price.slabId,
      ...(settlementType === "T0" ? { mode: "INSTANT" } : {}),
    },
  });

  // Book company margin + upline commission AT settlement time (funded from the
  // Revenue Wallet, net of 2% TDS), priced on the settled leg. Idempotent per
  // capture; the retailer credit already committed, so a commission failure must
  // never roll it back or FAIL the entry.
  try {
    await distributeCommissionForPg(
      entry.transactionRef,
      entry.userId,
      toNumber(entry.grossAmount as never),
      entry.paymentMode ?? "UPI",
      settlementType
    );
  } catch (e) {
    console.error("[pg settle] commission distribution failed:", entry.transactionRef, e);
  }

  return toNumber(netAmount);
}

export type PgInstantSettleResult = {
  requested: number;
  settled: number;
  failed: number;
  skipped: number;
  totalAmount: number;
  results: Array<{
    id: string;
    transactionRef: string | null;
    status: "SETTLED" | "SKIPPED" | "FAILED";
    netAmount?: number;
    reason?: string;
  }>;
};

/**
 * Retailer-driven INSTANT settlement (the dashboard button). Settles the given
 * PENDING entries owned by `userId` at the scheme's T0 rate. Anything not
 * instant-settled stays PENDING for the next-day T+1 cron. No double credit:
 * only PENDING entries load, and the pg-settle:<ref> ledger key + the T+1 sweep
 * (which reads only PENDING rows) guarantee at-most-once payout.
 */
export async function instantSettlePgEntries(
  userId: string,
  entryIds: string[]
): Promise<PgInstantSettleResult> {
  const unique = Array.from(new Set(entryIds)).slice(0, 200);
  const entries = await prisma.pgSettlementEntry.findMany({
    where: { id: { in: unique }, userId, status: "PENDING" },
    orderBy: { createdAt: "asc" },
  });

  let settled = 0;
  let failed = 0;
  let skipped = 0;
  let totalAmount = 0;
  const results: PgInstantSettleResult["results"] = [];

  for (const entry of entries) {
    try {
      const net = await settlePgEntry(entry, "T0", SETTLED_VIA.INSTANT_BUTTON);
      if (net === null) {
        skipped++;
        results.push({
          id: entry.id,
          transactionRef: entry.transactionRef,
          status: "SKIPPED",
          reason: "not priceable at the instant rate",
        });
        continue;
      }
      settled++;
      totalAmount += net;
      results.push({ id: entry.id, transactionRef: entry.transactionRef, status: "SETTLED", netAmount: net });
    } catch {
      failed++;
      results.push({ id: entry.id, transactionRef: entry.transactionRef, status: "FAILED", reason: "ledger error" });
    }
  }

  const found = new Set(entries.map((e) => e.id));
  for (const id of unique) {
    if (!found.has(id)) {
      skipped++;
      results.push({ id, transactionRef: null, status: "SKIPPED", reason: "already settled or not found" });
    }
  }

  return { requested: unique.length, settled, failed, skipped, totalAmount, results };
}

/**
 * The retailer's UNSETTLED PG proceeds plus an instant-settlement quote per
 * entry (net at the scheme's T0 rate). Powers the dashboard "Instant settle"
 * table: each row shows what lands now (instant) vs. what the T+1 sweep pays.
 */
export async function listPendingPgSettlements(userId: string) {
  const entries = await prisma.pgSettlementEntry.findMany({
    where: { userId, status: "PENDING" },
    orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
    take: 200,
  });

  const rows = [];
  for (const e of entries) {
    const instant = await priceSchemeSettlement({
      userId,
      serviceKind: "PG",
      grossAmount: toNumber(e.grossAmount),
      paymentMode: e.paymentMode ?? "UPI",
      settlementType: "T0",
      scopeKey: e.provider,
    });
    rows.push({
      id: e.id,
      transactionRef: e.transactionRef,
      orderId: e.orderId,
      grossAmount: toNumber(e.grossAmount),
      paymentMode: e.paymentMode,
      capturedAt: (e.capturedAt ?? e.createdAt).toISOString(),
      // T+1 (auto) figures priced at capture time.
      t1: { mdrAmount: toNumber(e.mdrAmount), netAmount: toNumber(e.netAmount) },
      // Instant (T0) quote — null when the T0 rate can't be resolved right now.
      instant: instant
        ? { mdrAmount: toNumber(instant.mdrAmount), netAmount: toNumber(instant.netAmount) }
        : null,
    });
  }
  return rows;
}

/**
 * PG T+1 cron: settle PENDING PG entries captured BEFORE the current IST day
 * into retailer wallets. Called by the worker at the configured hour; also
 * invocable manually. Each entry's MDR is re-verified at settlement time.
 */
export async function runPgT1SettlementSweep(): Promise<{
  processed: number;
  settled: number;
  failed: number;
  totalAmount: number;
}> {
  const config = await getSetting("settlement.pg_t1");
  if (!config.enabled || config.paused) {
    return { processed: 0, settled: 0, failed: 0, totalAmount: 0 };
  }

  const cutoff = startOfTodayIst();
  const entries = await prisma.pgSettlementEntry.findMany({
    where: {
      status: "PENDING",
      mode: "T1",
      OR: [{ capturedAt: { lt: cutoff } }, { capturedAt: null, createdAt: { lt: cutoff } }],
    },
    orderBy: { createdAt: "asc" },
    take: 500,
  });

  let settled = 0;
  let failed = 0;
  let totalAmount = 0;

  for (const entry of entries) {
    if (!gte(entry.netAmount, config.minAmount)) continue; // below minimum — leave for next run
    try {
      const net = await settlePgEntry(entry, "T1", SETTLED_VIA.T1_CRON);
      if (net === null) continue; // not priceable — leave PENDING
      settled++;
      totalAmount += net;
    } catch {
      await prisma.pgSettlementEntry.update({ where: { id: entry.id }, data: { status: "FAILED" } });
      failed++;
    }
  }

  return { processed: entries.length, settled, failed, totalAmount };
}

/**
 * PG instant-settlement safety-net cron: settle any INSTANT-mode entries left
 * PENDING (e.g. the confirmation created the entry but the wallet credit failed).
 * Runs frequently; each entry settles at most once via the pg-settle:<ref> key.
 */
export async function runPgInstantSettlementSweep(): Promise<{
  processed: number;
  settled: number;
  failed: number;
  totalAmount: number;
}> {
  const config = await getSetting("settlement.pg_instant");
  if (config.paused) {
    return { processed: 0, settled: 0, failed: 0, totalAmount: 0 };
  }

  const entries = await prisma.pgSettlementEntry.findMany({
    where: { status: "PENDING", mode: "INSTANT" },
    orderBy: { createdAt: "asc" },
    take: 500,
  });

  let settled = 0;
  let failed = 0;
  let totalAmount = 0;

  for (const entry of entries) {
    try {
      const net = await settlePgEntry(entry, "T0", SETTLED_VIA.INSTANT_AUTO);
      if (net === null) continue;
      settled++;
      totalAmount += net;
    } catch {
      await prisma.pgSettlementEntry.update({ where: { id: entry.id }, data: { status: "FAILED" } });
      failed++;
    }
  }

  return { processed: entries.length, settled, failed, totalAmount };
}
