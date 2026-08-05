import { prisma } from "@/lib/db";
import { creditWallet } from "@/lib/ledger";
import { getEffectiveMdr, type MdrDimensions } from "@/lib/mdr/resolver";
import { resolveBrandMdr } from "@/lib/brand/mdr";
import { distributeMdrCommission } from "@/lib/commission/distribute";
import { isAboveMdrFloor } from "@/lib/mdr/floor";
import { dec, sub, gte, toNumber, round, gt, eq } from "@/lib/money";
import { recordPayin } from "@/lib/wallet/payin";
import { getSetting } from "@/lib/settings";
import { SETTLED_VIA, type SettledVia } from "@/lib/settlement/engine";
import type { MdrServiceKind, ServiceCode } from "@prisma/client";

/**
 * POS acquirer settlement engine.
 *
 * Two modes (resolved per capture — see resolveSettlementMode):
 *   - INSTANT: credit happens synchronously when the webhook arrives.
 *   - T+1:     an entry is queued PENDING and swept by the daily worker cron
 *              (QUEUES.POS_SETTLEMENT_T1) at the configured IST hour; only
 *              entries captured BEFORE the current IST day settle (true T+1).
 *
 * MDR is priced PER BRAND. Each POS machine belongs to a Brand (teachway /
 * lagoon / avika, …) whose rate card (BrandMdrRate) sets the MDR for every
 * (provider, paymentMode, amount band). Before ANY settlement — instant at
 * capture, or in the T+1 sweep — the transaction is re-verified against the
 * brand's current rate, MDR deducted, and the net credited to the retailer.
 *
 * Machines with no brand fall back to the machine owner's own unified Scheme
 * MDR slabs (cascade model) so existing fleets keep settling.
 */

export type PosCaptureInput = {
  transactionRef: string;   // partner's unique txn ID (idempotency)
  machineId?: string;       // local PosMachine id
  terminalId?: string;      // partner TID (used to look up machine + user)
  grossAmount: number;
  paymentMode?: string;     // CARD | UPI | NFC | BHARATQR
  provider?: string;        // RAZORPAY | PAYTM | PINELAB | ... (overrides machine.provider)
  brandId?: string;         // explicit brand (overrides machine.brandId)
  // Card/acquirer dimensions — used by the legacy per-user MdrScheme path to
  // pick the most specific slab. Brand rate cards key on provider+paymentMode.
  company?: string;
  cardType?: string;
  brandType?: string;
  classification?: string;
  // When the swipe actually happened at the terminal. Defaults to now (the
  // webhook path). Pull-ingestion passes the partner's txn time so T+1 settles
  // on the correct capture day even when we learn of the capture a day late.
  capturedAt?: Date | string;
};

export type PosCaptureResult = {
  status: "SETTLED" | "QUEUED" | "DUPLICATE" | "SKIPPED" | "NO_SCHEME";
  netAmount?: number;
  mdrAmount?: number;
  mode?: string;
};

type PricedMdr = {
  mdrAmount: ReturnType<typeof dec>;
  brandId: string | null;
  provider: string | null;
  mdrRateId: string | null;
};

/**
 * Price a capture's MDR. Brand rate card wins when the machine has a brand;
 * otherwise the owner's own unified Scheme (cascade) is used. Returns null when the
 * money cannot be priced (no matching brand rate / no user scheme) — the caller
 * must park it rather than settle unpriced money.
 */
async function priceMdr(args: {
  userId: string;
  brandId: string | null;
  provider: string | null;
  paymentMode: string;
  grossAmount: number;
  settlementType: "T0" | "T1";
  dims?: Omit<MdrDimensions, "paymentMode" | "settlementType">;
}): Promise<PricedMdr | null> {
  let result: PricedMdr | null = null;

  if (args.brandId) {
    const brandMdr = await resolveBrandMdr({
      brandId: args.brandId,
      amount: args.grossAmount,
      provider: args.provider,
      paymentMode: args.paymentMode,
      cardType: args.dims?.cardType ?? null,
      brandType: args.dims?.brandType ?? null,
      classification: args.dims?.classification ?? null,
      settlementType: args.settlementType,
    });
    if (!brandMdr) return null;
    result = {
      mdrAmount: round(brandMdr.mdr),
      brandId: args.brandId,
      provider: args.provider,
      mdrRateId: brandMdr.rateId,
    };
  } else {
    // Legacy fallback: owner's own MDR scheme (card-dimension aware).
    const mdr = await getEffectiveMdr(args.userId, "POS" as MdrServiceKind, args.grossAmount, {
      paymentMode: args.paymentMode,
      settlementType: args.settlementType,
      company: args.dims?.company ?? null,
      cardType: args.dims?.cardType ?? null,
      brandType: args.dims?.brandType ?? null,
      classification: args.dims?.classification ?? null,
    });
    if (mdr.source === "NONE") return null;
    result = {
      mdrAmount: round(mdr.mdr),
      brandId: null,
      provider: args.provider,
      mdrRateId: mdr.slabId,
    };
  }

  // Runtime safety net: refuse to settle if the resolved MDR is below the
  // company floor. This catches stale rates or misconfigurations.
  const aboveFloor = await isAboveMdrFloor(
    "POS",
    args.paymentMode,
    result.mdrAmount,
    args.grossAmount,
    args.settlementType
  );
  if (!aboveFloor) return null;

  return result;
}

/**
 * Decide whether a capture settles instantly or T+1. Priority order:
 *   1. user.instantSettlement = true       → INSTANT (explicit per-user override)
 *   2. brand.settlementMode = "INSTANT"    → INSTANT (brand pinned to instant)
 *   3. brand.settlementMode = "T1"         → T+1 (brand pinned to next-day)
 *   4. brand.settlementMode = "BOTH"/null  → follow global default:
 *        global settlement.pos_instant.defaultEnabled → INSTANT, else T+1
 *
 * "BOTH" means the brand supports either mode and defers the decision to the
 * per-user flag (above) or the platform default.
 */
async function resolveSettlementMode(userInstant: boolean, brandMode: string | null): Promise<"INSTANT" | "T1"> {
  if (userInstant) return "INSTANT";
  if (brandMode === "INSTANT") return "INSTANT";
  if (brandMode === "T1") return "T1";
  const globalInstant = await getSetting("settlement.pos_instant");
  return globalInstant.defaultEnabled ? "INSTANT" : "T1";
}

export async function handlePosCapture(input: PosCaptureInput): Promise<PosCaptureResult> {
  // Idempotency — if we already processed this capture, skip.
  const existing = await prisma.posSettlementEntry.findUnique({
    where: { transactionRef: input.transactionRef },
  });
  if (existing) return { status: "DUPLICATE" };

  // Resolve the machine, its assigned user, brand, provider, and acquiring
  // company. The company label (PosMachine.company, e.g. "Sameday-AXIS") is a
  // PRICING dimension — MDR slabs can be pinned per acquirer, so a capture that
  // doesn't carry it can never match a company-pinned slab.
  let userId: string | null = null;
  let machineDbId: string | null = input.machineId ?? null;
  let brandId: string | null = input.brandId ?? null;
  let provider: string | null = input.provider ?? null;
  let company: string | null = input.company ?? null;

  if (!machineDbId && input.terminalId) {
    const machine = await prisma.posMachine.findFirst({
      where: { tid: input.terminalId, assignedUserId: { not: null } },
      select: { id: true, assignedUserId: true, brandId: true, provider: true, company: true },
    });
    if (machine) {
      machineDbId = machine.id;
      userId = machine.assignedUserId;
      brandId = brandId ?? machine.brandId;
      provider = provider ?? machine.provider;
      company = company ?? machine.company;
    }
  } else if (machineDbId) {
    const machine = await prisma.posMachine.findUnique({
      where: { id: machineDbId },
      select: { assignedUserId: true, brandId: true, provider: true, company: true },
    });
    userId = machine?.assignedUserId ?? null;
    brandId = brandId ?? machine?.brandId ?? null;
    provider = provider ?? machine?.provider ?? null;
    company = company ?? machine?.company ?? null;
  }

  if (!userId) return { status: "SKIPPED" };

  const paymentMode = input.paymentMode ?? "CARD";

  // Only ACTIVE users settle.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { instantSettlement: true, status: true },
  });
  if (!user || user.status !== "ACTIVE") return { status: "SKIPPED" };

  // Resolve the brand's default settlement mode (if branded).
  const brand = brandId
    ? await prisma.brand.findFirst({
        where: { id: brandId, active: true },
        select: { id: true, settlementMode: true },
      })
    : null;
  // A branded capture whose brand row is missing/inactive can't be trusted —
  // fall back to legacy user-scheme pricing by dropping the brand.
  if (brandId && !brand) brandId = null;

  const mode = await resolveSettlementMode(user.instantSettlement, brand?.settlementMode ?? null);
  const settlementType = mode === "INSTANT" ? "T0" : "T1";

  const dims: Omit<MdrDimensions, "paymentMode" | "settlementType"> = {
    company: company ?? null,
    cardType: input.cardType ?? null,
    brandType: input.brandType ?? null,
    classification: input.classification ?? null,
  };

  // Price MDR against the brand rate card (or legacy scheme). Refuse to settle
  // unpriced money — park it so admin can add a rate and replay the webhook.
  const priced = await priceMdr({
    userId,
    brandId,
    provider,
    paymentMode,
    grossAmount: input.grossAmount,
    settlementType,
    dims,
  });
  if (!priced) return { status: "NO_SCHEME" };

  const netAmount = round(sub(input.grossAmount, priced.mdrAmount));
  if (!gt(netAmount, 0)) return { status: "SKIPPED" };

  // Mirror the GROSS into the company payin wallet (best-effort live monitor),
  // once per canonical capture — regardless of instant vs T+1 settlement.
  await recordPayin({
    rail: "POS",
    grossAmount: input.grossAmount,
    refType: "PosSettlementEntry",
    refId: input.transactionRef,
    note: `POS payin (${paymentMode})`,
  });

  const capturedAt = input.capturedAt ? new Date(input.capturedAt) : new Date();
  const capturedAtValid = !Number.isNaN(capturedAt.getTime());

  if (mode === "INSTANT") {
    // Instant settlement — credit the wallet now. If the credit fails mid-flight
    // (e.g. a transient ledger error), park a PENDING/INSTANT entry so the
    // instant safety-net cron retries it; the pos-settle:<ref> idempotency key
    // guarantees the retailer is never credited twice.
    let wtxnId: string | null = null;
    try {
      const wtxn = await creditWallet({
        userId,
        amount: netAmount,
        reason: "POS_SETTLEMENT",
        refType: "PosSettlementEntry",
        refId: input.transactionRef,
        note: `POS instant settlement (${paymentMode})`,
        idempotencyKey: `pos-settle:${input.transactionRef}`,
      });
      wtxnId = wtxn.id;
    } catch {
      wtxnId = null;
    }

    try {
      await prisma.posSettlementEntry.create({
        data: {
          transactionRef: input.transactionRef,
          machineId: machineDbId,
          userId,
          grossAmount: dec(input.grossAmount),
          mdrAmount: priced.mdrAmount,
          netAmount,
          mode: "INSTANT",
          status: wtxnId ? "SETTLED" : "PENDING",
          settledAt: wtxnId ? new Date() : null,
          settledVia: wtxnId ? SETTLED_VIA.INSTANT_AUTO : null,
          walletTxnId: wtxnId,
          paymentMode,
          cardType: dims.cardType ?? null,
          brandType: dims.brandType ?? null,
          classification: dims.classification ?? null,
          company: dims.company ?? null,
          capturedAt: capturedAtValid ? capturedAt : null,
          brandId: priced.brandId,
          provider: priced.provider,
          mdrRateId: priced.mdrRateId,
        },
      });
    } catch (e) {
      // Another path (webhook vs ingest, or a retry) already inserted this exact
      // capture — the wallet credit above is idempotency-keyed, so no double
      // credit occurred. Treat as a duplicate and skip commission.
      if ((e as { code?: string }).code === "P2002") return { status: "DUPLICATE" };
      throw e;
    }

    await distributeCommissionForPos(input.transactionRef, userId, input.grossAmount, paymentMode, dims, settlementType);

    return {
      status: wtxnId ? "SETTLED" : "QUEUED",
      netAmount: toNumber(netAmount),
      mdrAmount: toNumber(priced.mdrAmount),
      mode: "INSTANT",
    };
  }

  // T+1 — queue for the daily cron. MDR is re-verified against the brand rate
  // at sweep time before crediting.
  try {
    await prisma.posSettlementEntry.create({
      data: {
        transactionRef: input.transactionRef,
        machineId: machineDbId,
        userId,
        grossAmount: dec(input.grossAmount),
        mdrAmount: priced.mdrAmount,
        netAmount,
        mode: "T1",
        status: "PENDING",
        paymentMode,
        cardType: dims.cardType ?? null,
        brandType: dims.brandType ?? null,
        classification: dims.classification ?? null,
        company: dims.company ?? null,
        capturedAt: capturedAtValid ? capturedAt : null,
        brandId: priced.brandId,
        provider: priced.provider,
        mdrRateId: priced.mdrRateId,
      },
    });
  } catch (e) {
    // Concurrent duplicate of the same canonical capture — the @unique ref
    // rejected the second insert. Skip commission so it's paid exactly once.
    if ((e as { code?: string }).code === "P2002") return { status: "DUPLICATE" };
    throw e;
  }

  // Commission still distributes instantly even in T+1 mode.
  await distributeCommissionForPos(input.transactionRef, userId, input.grossAmount, paymentMode, dims, settlementType);

  return {
    status: "QUEUED",
    netAmount: toNumber(netAmount),
    mdrAmount: toNumber(priced.mdrAmount),
    mode: "T1",
  };
}

/**
 * POS commission distribution (cascade model): each ancestor earns the MDR
 * margin between their child's Scheme MDR and their own, net of 2% TDS.
 * Creates a placeholder Transaction for the CommissionCredit FK, then
 * distributes via the MDR chain.
 */
async function distributeCommissionForPos(
  transactionRef: string,
  userId: string,
  grossAmount: number,
  paymentMode?: string,
  dims?: Omit<MdrDimensions, "paymentMode" | "settlementType">,
  settlementType: "T0" | "T1" = "T1"
) {
  const mdrDims: MdrDimensions = {
    paymentMode: paymentMode ?? "*",
    company: dims?.company ?? null,
    cardType: dims?.cardType ?? null,
    brandType: dims?.brandType ?? null,
    classification: dims?.classification ?? null,
    settlementType,
  };

  // Resolve the company MDR margin (MDR − vendor) from the SAME scheme the
  // commission is priced against, so the synthetic settlement transaction can
  // record it as the POS "fee". This makes the revenue "by service" breakdown
  // attribute POS correctly (platform revenue = fee − commission = margin −
  // commission), matching the Revenue Wallet.
  const mdr = await getEffectiveMdr(userId, "POS" as MdrServiceKind, grossAmount, mdrDims);
  const marginFee = round(mdr.margin);

  // We need a Transaction row for the CommissionCredit FK. Create a synthetic
  // settlement entry keyed 1:1 with the canonical capture ref (NO truncation —
  // a slice could collide two distinct captures onto one refId and silently
  // drop the second's commission). service = POS (first-class) so earnings and
  // commission attribute per-service. Idempotent per capture via @unique.
  const refId = `POS:${transactionRef}`;
  let txn = await prisma.transaction.findUnique({ where: { refId } });
  if (!txn) {
    try {
      txn = await prisma.transaction.create({
        data: {
          refId,
          userId,
          service: "POS" as ServiceCode,
          amount: dec(grossAmount),
          fee: marginFee,
          status: "SUCCESS",
          partner: "SAMEDAY_POS",
          partnerTxnId: transactionRef,
        },
      });
    } catch (e) {
      // A concurrent capture raced us to the same refId — reuse the winner's row
      // so commission still distributes exactly once (idempotency-keyed below).
      if ((e as { code?: string }).code === "P2002") {
        txn = await prisma.transaction.findUnique({ where: { refId } });
      }
      if (!txn) throw e;
    }
  }

  const results = await distributeMdrCommission(
    txn.id,
    userId,
    "POS" as MdrServiceKind,
    grossAmount,
    txn.service,
    mdrDims
  );

  // Record the total GROSS commission distributed on the settlement transaction
  // so per-service commission and platform revenue (fee − commission) read
  // cleanly from this single row. Idempotent: replays resolve the same figure.
  const grossComm = results.reduce((sum, r) => sum + r.gross, 0);
  if (grossComm > 0) {
    await prisma.transaction.update({
      where: { id: txn.id },
      data: { commission: dec(round(grossComm)) },
    });
  }
}

/** Start of the current IST calendar day, as a UTC Date. */
function startOfTodayIst(now = new Date()): Date {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const startIstMs = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  return new Date(startIstMs - 5.5 * 60 * 60 * 1000);
}

type PendingEntry = {
  id: string;
  transactionRef: string;
  userId: string;
  grossAmount: unknown;
  mdrAmount: unknown;
  netAmount: unknown;
  paymentMode: string | null;
  cardType: string | null;
  brandType: string | null;
  classification: string | null;
  company: string | null;
  brandId: string | null;
  provider: string | null;
  mdrRateId: string | null;
};

/**
 * Settle a single PENDING entry and credit the retailer wallet.
 *
 * Branded entries are RE-VERIFIED against the brand's CURRENT rate at
 * settlement time (rates may have changed since capture); the fresh MDR/net is
 * persisted. Legacy (user-scheme) entries credit their capture-time net — their
 * card dimensions aren't persisted on the entry, so re-resolving could pick a
 * different slab; the price is therefore locked at swipe time for those.
 *
 * Returns the net credited, or null when it can't be settled (leave PENDING).
 */
async function settleEntry(
  entry: PendingEntry,
  settlementType: "T0" | "T1",
  via: SettledVia
): Promise<number | null> {
  const gross = dec(entry.grossAmount as never);
  let netAmount = round(dec(entry.netAmount as never));
  let freshMdr: PricedMdr | null = null;

  // Re-price when the entry is BRANDED (the brand rate may have changed since
  // capture), OR whenever we settle INSTANT/T0 — the capture-time net was
  // priced at the T1 rate, so instant settlement must re-resolve at the T0 rate
  // (the scheme-assigned instant charge) before crediting.
  if (entry.brandId || settlementType === "T0") {
    freshMdr = await priceMdr({
      userId: entry.userId,
      brandId: entry.brandId,
      provider: entry.provider,
      paymentMode: entry.paymentMode ?? "CARD",
      grossAmount: toNumber(gross),
      settlementType,
      // Re-resolve against the SAME dimensions the capture was priced on, so a
      // company-pinned / classification-specific rate is honoured at settlement.
      dims: {
        company: entry.company,
        cardType: entry.cardType,
        brandType: entry.brandType,
        classification: entry.classification,
      },
    });
    if (!freshMdr) return null; // rate no longer resolvable — leave PENDING for admin
    netAmount = round(sub(gross, freshMdr.mdrAmount));
  }

  if (!gt(netAmount, 0)) return null;

  const wtxn = await creditWallet({
    userId: entry.userId,
    amount: netAmount,
    reason: "POS_SETTLEMENT",
    refType: "PosSettlementEntry",
    refId: entry.id,
    note: `POS ${settlementType === "T0" ? "instant" : "T+1"} settlement (${entry.paymentMode ?? "card"})`,
    idempotencyKey: `pos-settle:${entry.transactionRef}`,
  });

  // Persist re-priced figures (branded or instant) alongside the settlement.
  const mdrChanged = freshMdr !== null && !eq(freshMdr.mdrAmount, dec(entry.mdrAmount as never));
  await prisma.posSettlementEntry.update({
    where: { id: entry.id },
    data: {
      status: "SETTLED",
      settledAt: new Date(),
      walletTxnId: wtxn.id,
      settledVia: via,
      // Instant settlement re-labels the entry's mode so audit reflects reality.
      ...(settlementType === "T0" ? { mode: "INSTANT" } : {}),
      ...(mdrChanged
        ? { mdrAmount: freshMdr!.mdrAmount, netAmount, mdrRateId: freshMdr!.mdrRateId }
        : {}),
    },
  });

  return toNumber(netAmount);
}

/**
 * Retailer-driven INSTANT settlement (the dashboard button). Settles the given
 * PENDING entries owned by `userId` at the scheme's T0 rate, crediting each
 * net immediately. Anything the retailer doesn't instant-settle stays PENDING
 * and is swept by the next-day T+1 cron.
 *
 * No double credit: only PENDING entries are loaded, `settleEntry` credits with
 * the `pos-settle:<ref>` ledger idempotency key, and once SETTLED the T+1 sweep
 * (which reads only PENDING rows) can never touch them again.
 */
export type InstantSettleResult = {
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

export async function instantSettleEntries(
  userId: string,
  entryIds: string[]
): Promise<InstantSettleResult> {
  const unique = Array.from(new Set(entryIds)).slice(0, 200);
  const entries = await prisma.posSettlementEntry.findMany({
    where: { id: { in: unique }, userId, status: "PENDING" },
    orderBy: { createdAt: "asc" },
  });

  let settled = 0;
  let failed = 0;
  let skipped = 0;
  let totalAmount = 0;
  const results: InstantSettleResult["results"] = [];

  for (const entry of entries) {
    try {
      const net = await settleEntry(entry, "T0", SETTLED_VIA.INSTANT_BUTTON);
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

  // Anything requested but not loaded was already settled / not owned by the caller.
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
 * The retailer's UNSETTLED POS proceeds plus an instant-settlement quote per
 * entry (net at the scheme's T0 rate). Powers the dashboard "Instant settle"
 * table: each row shows what lands now (instant) vs. what the T+1 sweep would
 * pay tomorrow.
 */
export async function listPendingPosSettlements(userId: string) {
  const entries = await prisma.posSettlementEntry.findMany({
    where: { userId, status: "PENDING" },
    orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
    take: 200,
  });

  const rows = [];
  for (const e of entries) {
    const instant = await priceMdr({
      userId,
      brandId: e.brandId,
      provider: e.provider,
      paymentMode: e.paymentMode ?? "CARD",
      grossAmount: toNumber(e.grossAmount),
      settlementType: "T0",
      dims: {
        company: e.company,
        cardType: e.cardType,
        brandType: e.brandType,
        classification: e.classification,
      },
    });
    rows.push({
      id: e.id,
      transactionRef: e.transactionRef,
      grossAmount: toNumber(e.grossAmount),
      paymentMode: e.paymentMode,
      capturedAt: (e.capturedAt ?? e.createdAt).toISOString(),
      // T+1 (auto) figures priced at capture time.
      t1: { mdrAmount: toNumber(e.mdrAmount), netAmount: toNumber(e.netAmount) },
      // Instant (T0) quote — null when the T0 rate can't be resolved right now.
      instant: instant
        ? {
            mdrAmount: toNumber(instant.mdrAmount),
            netAmount: toNumber(round(sub(e.grossAmount, instant.mdrAmount))),
          }
        : null,
    });
  }
  return rows;
}

/**
 * T+1 cron: settle PENDING POS entries captured BEFORE the current IST day
 * into retailer wallets. Called by the worker at the configured hour
 * (default 09:00 IST); also invocable manually via the admin API. Each entry's
 * MDR is re-verified against the brand's current rate before crediting.
 */
export async function runPosT1SettlementSweep(): Promise<{
  processed: number;
  settled: number;
  failed: number;
  totalAmount: number;
}> {
  const config = await getSetting("settlement.pos_t1");
  if (!config.enabled || config.paused) {
    return { processed: 0, settled: 0, failed: 0, totalAmount: 0 };
  }

  // True T+1: only captures from previous IST days are due. Settle by CAPTURE
  // date so a capture pull-ingested a day late still settles on its correct
  // day; legacy rows without capturedAt fall back to their createdAt.
  const todayStart = startOfTodayIst();

  // Per-company (brand) T+1 cutoff. A capture taken at/after the brand's cutoff
  // IST hour belongs to the NEXT business day, so it becomes due one day later
  // (i.e. T+2). The DB pre-filter below (capturedAt < todayStart) is a SUPERSET
  // of every brand's due set — the latest possible boundary is todayStart
  // (cutoff = end of day) — so we fetch that set and hold "late" captures per
  // brand in code. As todayStart advances each day, a held capture naturally
  // clears its brand boundary on the next run, landing it on T+2.
  const brandCutoffs = await prisma.brand.findMany({ select: { id: true, t1CutoffHour: true } });
  const cutoffByBrand = new Map(brandCutoffs.map((b) => [b.id, b.t1CutoffHour]));
  const HOUR_MS = 60 * 60 * 1000;
  const dueBoundary = (brandId: string | null): Date => {
    const hour = brandId ? cutoffByBrand.get(brandId) ?? null : null;
    // null / out-of-range → no early cutoff → whole previous day is due today.
    if (hour === null || hour < 0 || hour >= 24) return todayStart;
    return new Date(todayStart.getTime() - (24 - hour) * HOUR_MS);
  };

  const entries = await prisma.posSettlementEntry.findMany({
    where: {
      status: "PENDING",
      mode: "T1",
      OR: [{ capturedAt: { lt: todayStart } }, { capturedAt: null, createdAt: { lt: todayStart } }],
    },
    orderBy: { createdAt: "asc" },
    take: 500,
  });

  let settled = 0;
  let failed = 0;
  let totalAmount = 0;

  for (const entry of entries) {
    // Company cutoff gate: hold captures taken at/after the brand's cutoff for
    // their T+2 run. capturedAt drives the call; legacy rows fall back to
    // createdAt. Brands with no cutoff use todayStart (classic T+1).
    const captured = entry.capturedAt ?? entry.createdAt;
    if (captured >= dueBoundary(entry.brandId)) continue;

    if (!gte(entry.netAmount, config.minAmount)) {
      continue; // Below minimum — leave for next run
    }

    try {
      const net = await settleEntry(entry, "T1", SETTLED_VIA.T1_CRON);
      if (net === null) continue; // not priceable / below zero — leave PENDING
      settled++;
      totalAmount += net;
    } catch {
      await prisma.posSettlementEntry.update({
        where: { id: entry.id },
        data: { status: "FAILED" },
      });
      failed++;
    }
  }

  return { processed: entries.length, settled, failed, totalAmount };
}

/**
 * Instant-settlement safety-net cron: settle any INSTANT-mode entries left
 * PENDING (e.g. the webhook created the entry but the wallet credit failed, or
 * an entry was replayed). Runs frequently; each entry settles at most once via
 * the pos-settle:<ref> ledger idempotency key. MDR is re-verified against the
 * brand's current instant (T0) rate before crediting.
 */
export async function runPosInstantSettlementSweep(): Promise<{
  processed: number;
  settled: number;
  failed: number;
  totalAmount: number;
}> {
  const config = await getSetting("settlement.pos_instant");
  if (config.paused) {
    return { processed: 0, settled: 0, failed: 0, totalAmount: 0 };
  }

  const entries = await prisma.posSettlementEntry.findMany({
    where: { status: "PENDING", mode: "INSTANT" },
    orderBy: { createdAt: "asc" },
    take: 500,
  });

  let settled = 0;
  let failed = 0;
  let totalAmount = 0;

  for (const entry of entries) {
    try {
      const net = await settleEntry(entry, "T0", SETTLED_VIA.INSTANT_AUTO);
      if (net === null) continue;
      settled++;
      totalAmount += net;
    } catch {
      await prisma.posSettlementEntry.update({
        where: { id: entry.id },
        data: { status: "FAILED" },
      });
      failed++;
    }
  }

  return { processed: entries.length, settled, failed, totalAmount };
}
