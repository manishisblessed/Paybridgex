import { SERVICE_KEYS, KNOWN_SERVICE_ROUTES } from "./catalog";
import { SERVICE_FAMILIES } from "@/lib/scheme/constants";

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

/** Every bill-category ServiceCode the BBPS scheme-family modal can price. */
const BBPS_BILL_SERVICES: readonly string[] = SERVICE_FAMILIES.find((f) => f.key === "BBPS")!.services;

const CREDIT_CARD_SERVICE = "BILL_CREDIT_CARD";

/**
 * Credit Card Bill Payment / Credit Card Bill Payment-2 are the only products
 * that may price BILL_CREDIT_CARD. Bharat BillPay and Unified Bill Payment
 * price utility categories only (electricity, water, gas, education, insurance)
 * — they must never fan out a credit-card slab.
 */
const CC_ONLY_SCOPES = new Set<string>([
  BBPS_PRICE_SCOPES.BBPS_CREDIT_CARD,
  BBPS_PRICE_SCOPES.RECHARGEKIT_CC,
]);
const UTILITY_ONLY_SCOPES = new Set<string>([
  BBPS_PRICE_SCOPES.BBPS_SAMEDAY,
  BBPS_PRICE_SCOPES.BBPS_BULKPE,
  "bbps_bulkpe", // legacy pricing key retained in the catalog
]);

/**
 * Bill categories a BBPS product is allowed to price. Used by the scheme-slab
 * modal ("All Services" expands to this list) and the create/update APIs.
 */
export function bbpsServicesForProvider(provider: string | null | undefined): readonly string[] {
  const key = (provider ?? "").trim();
  if (!key) return BBPS_BILL_SERVICES;
  if (CC_ONLY_SCOPES.has(key)) return [CREDIT_CARD_SERVICE];
  if (UTILITY_ONLY_SCOPES.has(key)) return BBPS_BILL_SERVICES.filter((s) => s !== CREDIT_CARD_SERVICE);
  return BBPS_BILL_SERVICES;
}

/** Inverse of {@link bbpsServicesForProvider} — product scopes that may price `service`. */
export function bbpsProvidersForService(service: string): string[] {
  return SCOPE_KEYS.filter((key) => bbpsServicesForProvider(key).includes(service));
}

/** True when this (service, provider) pair is a valid BBPS slab pin. Non-BBPS always passes. */
export function isBbpsServiceProviderCompatible(
  service: string,
  provider: string | null | undefined
): boolean {
  if (!service.startsWith("BILL_") && service !== "RECHARGE_BROADBAND") return true;
  const key = (provider ?? "").trim();
  if (!key) return true;
  return bbpsServicesForProvider(key).includes(service);
}

/** User-facing error when a BBPS product is pinned to the wrong bill category, or null. */
export function bbpsServiceProviderMismatch(
  service: string,
  provider: string | null | undefined
): string | null {
  if (isBbpsServiceProviderCompatible(service, provider)) return null;
  const product = priceScopeLabel(provider) ?? provider;
  const allowed = bbpsServicesForProvider(provider)
    .map((s) => s.replace(/_/g, " "))
    .join(", ");
  return `${product} only prices ${allowed}. It cannot be added to ${service.replace(/_/g, " ")}.`;
}
