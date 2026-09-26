// =====================================================================
// Transaction "service category" filters — a single source of truth shared by
// the All Transactions page (dropdown options) and the /api/transactions API
// (Prisma `where` fragments). Each category maps a user-facing label to the
// underlying ServiceCode(s) and/or per-product priceScope that identify it.
//
// This keeps the client dropdown and the server query in lock-step: add a
// category here and both sides pick it up.
// =====================================================================

import { BBPS_PRICE_SCOPES } from "./priceScope";

export type TxnCategory = {
  /** Stable key sent from the client as `?service=` (never localise this). */
  key: string;
  /** Human label rendered in the filter dropdown. */
  label: string;
  /** Prisma `where` fragment that isolates this category's transactions. */
  where: Record<string, unknown>;
};

/**
 * The categories surfaced in the All Transactions "Service" filter. Order here
 * is the order shown in the dropdown (after the leading "All Services" entry).
 */
export const TXN_CATEGORIES: TxnCategory[] = [
  { key: "POS", label: "POS", where: { service: "POS" } },
  { key: "QR", label: "QR", where: { service: "QR" } },
  {
    key: "PAYOUT",
    label: "Payout",
    where: { service: { in: ["PAYOUT", "UPI_PAYOUT"] } },
  },
  {
    key: "BBPS",
    label: "BBPS-Bharat BillPay",
    where: { priceScope: BBPS_PRICE_SCOPES.BBPS_SAMEDAY },
  },
  {
    key: "CREDIT_CARD",
    label: "Credit Card Bill Payment",
    where: { priceScope: BBPS_PRICE_SCOPES.BBPS_CREDIT_CARD },
  },
  {
    key: "CREDIT_CARD_2",
    label: "Credit Card Bill Payment-2",
    where: { priceScope: BBPS_PRICE_SCOPES.RECHARGEKIT_CC },
  },
];

/** Dropdown options including the leading "All Services" (empty key) entry. */
export const TXN_CATEGORY_OPTIONS: Array<{ key: string; label: string }> = [
  { key: "All", label: "All Services" },
  ...TXN_CATEGORIES.map(({ key, label }) => ({ key, label })),
];

/**
 * Resolve a category key to its Prisma `where` fragment. Returns null for the
 * "All" / empty / unknown case so the caller applies no service constraint.
 */
export function txnCategoryWhere(
  key: string | null | undefined
): Record<string, unknown> | null {
  if (!key || key === "All") return null;
  return TXN_CATEGORIES.find((c) => c.key === key)?.where ?? null;
}
