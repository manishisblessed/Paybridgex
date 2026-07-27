import type { MdrServiceKind } from "@prisma/client";
import { getEffectiveMdr } from "@/lib/mdr/resolver";
import { isAboveMdrFloor } from "@/lib/mdr/floor";
import { resolveRailMdr } from "@/lib/rail/mdr";
import { dec, gt, round, sub, type Money } from "@/lib/money";
import { getSetting } from "@/lib/settings";

/**
 * Shared settlement primitives for the acquiring rails (POS / PG / QR).
 *
 * The client model: a transaction lands UNSETTLED, and the retailer either
 * presses "Instant settle" (paid at the scheme's T0 rate) or lets the next-day
 * T+1 cron settle the rest (at the cheaper T1 rate). The "instant fee" is not a
 * separate charge — it is simply the scheme's T0 MDR (mdrValueT0), so the
 * effective premium for settling early = MDR(T0) − MDR(T1).
 *
 * The no-double-credit guarantee is enforced by every caller with the same
 * triple lock:
 *   1. a conditional status transition (PENDING/SETTLEABLE → SETTLED) claimed
 *      with updateMany BEFORE any credit — only one writer can win;
 *   2. a ledger idempotencyKey on the wallet credit — a racing writer's credit
 *      is refused even if it slips past the status gate;
 *   3. the T+1 cron only ever reads rows still awaiting settlement, so anything
 *      already instant-settled is invisible to it.
 */

/** How a settlement was triggered — persisted for audit / reporting. */
export const SETTLED_VIA = {
  /** Auto-instant at capture (per-user / per-brand / global flag). */
  INSTANT_AUTO: "INSTANT_AUTO",
  /** Retailer pressed "Instant settle" on the dashboard (T0 rate). */
  INSTANT_BUTTON: "INSTANT_BUTTON",
  /** Swept by the next-day T+1 settlement cron (T1 rate). */
  T1_CRON: "T1_CRON",
} as const;

export type SettledVia = (typeof SETTLED_VIA)[keyof typeof SETTLED_VIA];

export type SchemeSettlementPrice = {
  /** Absolute scheme MDR (₹) deducted for this settlement. */
  mdrAmount: Money;
  /** gross − MDR credited to the retailer wallet. */
  netAmount: Money;
  schemeId: string | null;
  slabId: string | null;
  /**
   * Live acquirer (vendor) cost resolved from the provider's rail rate card
   * (RailMdrRate) at settlement time, if one applies. This is what the platform
   * pays the acquirer; the company margin for the settlement = mdrAmount −
   * vendorAmount. null when the rail has no matching rate (older/unconfigured
   * providers) — the scheme MDR then settles as-is.
   */
  vendorAmount: Money | null;
  /** The RailMdrRate id backing vendorAmount (for audit), if any. */
  vendorRateId: string | null;
};

/**
 * Price a settlement against the user's ASSIGNED SCHEME for an acquiring rail.
 * `settlementType` selects the rate leg: "T0" (instant) uses the scheme's
 * mdrValueT0; "T1" uses the standard mdrValue.
 *
 * Returns null when the money cannot be priced (no matching scheme slab, MDR
 * below the company floor, or a non-positive net) — the caller MUST NOT settle
 * unpriced money; it should leave the row awaiting settlement instead.
 */
export async function priceSchemeSettlement(args: {
  userId: string;
  serviceKind: MdrServiceKind;
  grossAmount: Money | string | number;
  paymentMode?: string;
  settlementType: "T0" | "T1";
  /**
   * Per-entity scope for the floor check (PG pipeline / QR provider). When the
   * caller knows the routing pipeline it can pass it so a pipeline-scoped
   * CompanyMdrFloor applies. Omit for a rail-wide floor check.
   */
  scopeKey?: string | null;
}): Promise<SchemeSettlementPrice | null> {
  const gross = round(args.grossAmount);
  const paymentMode = args.paymentMode ?? "UPI";

  const mdr = await getEffectiveMdr(args.userId, args.serviceKind, gross, {
    paymentMode,
    settlementType: args.settlementType,
  });
  if (mdr.source === "NONE") return null;

  const mdrAmount = round(mdr.mdr);

  // Company floor safety net — refuse to settle below the platform minimum.
  const aboveFloor = await isAboveMdrFloor(
    args.serviceKind,
    paymentMode,
    mdrAmount,
    gross,
    args.settlementType,
    args.scopeKey
  );
  if (!aboveFloor) return null;

  // Acquirer-cost guard — re-verify the scheme MDR against the provider's LIVE
  // rail rate card (RailMdrRate) at settlement time. The slab's vendor charge is
  // locked to the approved rail rate at config time, but the rate may have moved
  // since; resolving it here is the runtime analogue of how POS re-prices branded
  // captures against the current BrandMdrRate. If the live acquirer cost now
  // exceeds the scheme MDR we'd be settling below cost — refuse and leave the row
  // awaiting settlement so admin can re-price. No rail rate configured for the
  // provider → no guard (backward compatible with existing QR settlements).
  let vendorAmount: Money | null = null;
  let vendorRateId: string | null = null;
  if (args.scopeKey && (args.serviceKind === "PG" || args.serviceKind === "QR")) {
    const railVendor = await resolveRailMdr({
      serviceKind: args.serviceKind,
      scopeKey: args.scopeKey,
      amount: gross,
      paymentMode,
      settlementType: args.settlementType,
    });
    if (railVendor) {
      vendorAmount = round(railVendor.mdr);
      vendorRateId = railVendor.rateId;
      if (gt(vendorAmount, mdrAmount)) return null;
    }
  }

  const netAmount = round(sub(gross, mdrAmount));
  if (!gt(netAmount, 0)) return null;

  return {
    mdrAmount,
    netAmount,
    schemeId: mdr.schemeId,
    slabId: mdr.slabId,
    vendorAmount,
    vendorRateId,
  };
}

/** Start of the current IST calendar day, as a UTC Date (the T+1 cutoff). */
export function startOfTodayIst(now = new Date()): Date {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const startIstMs = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  return new Date(startIstMs - 5.5 * 60 * 60 * 1000);
}

/** Convenience: does `net` clear the configured minimum settlement amount? */
export function meetsMinimum(net: Money | string | number, minAmount: number): boolean {
  return dec(net).gte(dec(minAmount));
}

/**
 * Is the retailer-facing INSTANT settlement button enabled for this rail?
 * Admin-controlled via the `settlement.instant_button` platform setting. When
 * false, retailers can't instant-settle and everything auto-settles T+1.
 */
export async function isInstantButtonEnabled(rail: "POS" | "QR" | "PG"): Promise<boolean> {
  const cfg = await getSetting("settlement.instant_button");
  if (rail === "POS") return cfg.posEnabled;
  if (rail === "PG") return cfg.pgEnabled;
  return cfg.qrEnabled;
}
