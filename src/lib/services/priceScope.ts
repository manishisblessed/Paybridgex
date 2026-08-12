import { SERVICE_KEYS, KNOWN_SERVICE_ROUTES } from "./catalog";

/**
 * Per-product BBPS "price scope".
 *
 * BBPS/CC bill payments run across four distinct products that must be priced,
 * floored, and reported INDEPENDENTLY — even when two of them ride the same
 * upstream partner (Same Day serves both "Bharat BillPay" and the CC-only
 * "RechargeKit" rails). We use each product's unique ServiceRoute key as the
 * pricing scope and thread it end-to-end:
 *   - the scheme slab is pinned to the scope (customer charge per product),
 *   - the rail rate card is keyed by the scope (vendor cost + minimum), and
 *   - the Transaction records the scope (revenue reported per product).
 *
 * Legacy slabs/cards pinned to the partner family ("SAMEDAY"/"BULKPE") keep
 * resolving via {@link priceScopeFamily} as a fallback until re-pinned.
 */
export const BBPS_PRICE_SCOPES = {
  /** BBPS-Bharat BillPay (bbps-1) — Same Day. */
  BBPS_SAMEDAY: SERVICE_KEYS.BBPS_SAMEDAY,
  /** Credit Card Bill Payment (credit-card) — Same Day Pay2New. */
  BBPS_CREDIT_CARD: SERVICE_KEYS.BBPS_CREDIT_CARD,
  /** Credit Card Bill Payment-2 (cc-pay) — Same Day RechargeKit. */
  RECHARGEKIT_CC: SERVICE_KEYS.RECHARGEKIT_CC,
  /** Unified Bill Payment Platform (bbps-2) — BulkPe. */
  BBPS_BULKPE: SERVICE_KEYS.BBPS_BULKPE,
} as const;

export type BbpsPriceScope = (typeof BBPS_PRICE_SCOPES)[keyof typeof BBPS_PRICE_SCOPES];

const SCOPE_KEYS: readonly string[] = Object.values(BBPS_PRICE_SCOPES);

/** Map each product scope to the backing partner family (for the fallback). */
const SCOPE_FAMILY: Record<string, "SAMEDAY" | "BULKPE"> = {
  [BBPS_PRICE_SCOPES.BBPS_SAMEDAY]: "SAMEDAY",
  [BBPS_PRICE_SCOPES.BBPS_CREDIT_CARD]: "SAMEDAY",
  [BBPS_PRICE_SCOPES.RECHARGEKIT_CC]: "SAMEDAY",
  [BBPS_PRICE_SCOPES.BBPS_BULKPE]: "BULKPE",
};

/** Friendly product name per scope, sourced from the service catalog. */
const SCOPE_LABEL: Record<string, string> = Object.fromEntries(
  KNOWN_SERVICE_ROUTES.filter((r) => SCOPE_KEYS.includes(r.key)).map((r) => [r.key, r.name])
);

/** True when `v` is one of the known BBPS product price scopes. */
export function isBbpsPriceScope(v: string | null | undefined): v is BbpsPriceScope {
  return !!v && SCOPE_KEYS.includes(v);
}

/** The partner family a scope falls back to (null when not a product scope). */
export function priceScopeFamily(scope: string | null | undefined): "SAMEDAY" | "BULKPE" | null {
  return scope && SCOPE_FAMILY[scope] ? SCOPE_FAMILY[scope] : null;
}

/** Friendly product label for a scope (falls back to the raw scope value). */
export function priceScopeLabel(scope: string | null | undefined): string | null {
  if (!scope) return null;
  return SCOPE_LABEL[scope] ?? scope;
}

/** Options for the Commission Master product-scope picker + revenue labels. */
export const BBPS_PRICE_SCOPE_OPTIONS: Array<{ key: string; name: string; partner: string }> =
  SCOPE_KEYS.map((key) => ({
    key,
    name: SCOPE_LABEL[key] ?? key,
    partner: SCOPE_FAMILY[key] ?? "",
  }));
