import { SERVICE_KEYS } from "./catalog";

/**
 * Resolve a BBPS bill category to the granular service key that gates it.
 * CREDIT_CARD routes through the Credit Card tab; every other category routes
 * through the Unified Bill Payment Platform (BBPS-2). Both are served by the
 * Same Day Bharat BillPay rail. Returns null for unknown categories so the
 * caller still sees the master BBPS gate.
 */
export function bbpsServiceKey(category: string | null | undefined): string | null {
  switch ((category || "").toUpperCase()) {
    case "CREDIT_CARD":
      return SERVICE_KEYS.BBPS_CREDIT_CARD;
    case "ELECTRICITY":
    case "WATER":
    case "GAS":
    case "EDUCATION":
    case "INSURANCE":
    case "BROADBAND":
      return SERVICE_KEYS.BBPS_BULKPE;
    default:
      return null;
  }
}
