// =====================================================================
// Service route catalog — single source of truth for the toggleable rails
// that power the On/Off Services panel. Pure data + a seed helper; this file
// must stay free of runtime side-effects so it is safely importable from the
// Prisma seed (`prisma/seed.ts`, run via tsx) AND from API/guard code.
// =====================================================================

import type { PrismaClient } from "@prisma/client";

export type ServiceRouteType = "SERVICE" | "CONFIG" | "SETTING";

export type ServiceRouteKind =
  | "PG"
  | "POS"
  | "BBPS"
  | "PAYOUT"
  | "QR"
  | "UPI"
  | "RECHARGE"
  | "AEPS"
  | "DMT"
  | "TRAVEL"
  | "OTHER";

export type ServiceRouteSeed = {
  /** Machine key used by the guard (assertServiceEnabled). Stable forever. */
  key: string;
  name: string;
  type: ServiceRouteType;
  kind: ServiceRouteKind;
  provider?: string | null;
  enabled: boolean;
  note?: string | null;
  sortOrder: number;
};

/**
 * Canonical machine keys consumed by the server guard. Reference these
 * constants in money/feature routes instead of hardcoding strings so a rename
 * is a single edit.
 */
export const SERVICE_KEYS = {
  PAYOUT: "payout_bulkpe",
  PG: "pg_razorpay",
  POS: "pos_sameday",
  QR: "qr_dynamic",
  UPI: "upi_collect",
  DMT: "dmt_imps",
  AEPS: "aeps_withdraw",
  RECHARGE: "recharge_mobile",
  BBPS: "bbps_billpay",
  BBPS_SAMEDAY: "bbps_sameday",
  BBPS_BULKPE: "bbps_bulkpe_svc",
  BBPS_CREDIT_CARD: "bbps_credit_card",
  TRAVEL: "travel_booking",
  VERIFICATION: "verify_ekychub",
  VIRTUAL_ACCOUNT: "virtual_account",
  RECHARGEKIT_CC: "rechargekit_cc",
} as const;

export type ServiceKey = (typeof SERVICE_KEYS)[keyof typeof SERVICE_KEYS];

/**
 * Maps service keys to sidebar nav hrefs. Used by the Sidebar to hide disabled
 * services for network users (RT/DT/MD/SD).
 */
export const SERVICE_KEY_TO_HREF: Record<string, string> = {
  [SERVICE_KEYS.PG]: "/dashboard/pg",
  [SERVICE_KEYS.POS]: "/dashboard/pos",
  [SERVICE_KEYS.QR]: "/dashboard/qr",
  [SERVICE_KEYS.PAYOUT]: "/dashboard/payout",
  [SERVICE_KEYS.AEPS]: "/dashboard/aadhaar-pay",
  [SERVICE_KEYS.UPI]: "/dashboard/upi",
  [SERVICE_KEYS.RECHARGE]: "/dashboard/recharge/mobile",
  [SERVICE_KEYS.BBPS]: "/dashboard/bill-pay/electricity",
  [SERVICE_KEYS.BBPS_SAMEDAY]: "/dashboard/bill-pay/bbps-1",
  [SERVICE_KEYS.BBPS_BULKPE]: "/dashboard/bill-pay/bbps-2",
  [SERVICE_KEYS.BBPS_CREDIT_CARD]: "/dashboard/bill-pay/credit-card",
  [SERVICE_KEYS.RECHARGEKIT_CC]: "/dashboard/bill-pay/cc-pay",
  [SERVICE_KEYS.DMT]: "/dashboard/money-transfer",
  [SERVICE_KEYS.TRAVEL]: "/dashboard/travel/flight",
  [SERVICE_KEYS.VIRTUAL_ACCOUNT]: "/dashboard/virtual-account",
};

/**
 * Dashboard route prefixes owned by each service key. Used to decide whether
 * a nav link / quick tile belongs to a toggleable service (sub-routes like
 * /dashboard/bill-pay/water map to BBPS via the /dashboard/bill-pay prefix).
 */
const SERVICE_HREF_PREFIXES: Array<[prefix: string, key: string]> = [
  ["/dashboard/pg", SERVICE_KEYS.PG],
  ["/dashboard/pos", SERVICE_KEYS.POS],
  ["/dashboard/qr", SERVICE_KEYS.QR],
  ["/dashboard/payout", SERVICE_KEYS.PAYOUT],
  ["/dashboard/aadhaar-pay", SERVICE_KEYS.AEPS],
  ["/dashboard/upi", SERVICE_KEYS.UPI],
  ["/dashboard/recharge", SERVICE_KEYS.RECHARGE],
  ["/dashboard/bill-pay/bbps-1", SERVICE_KEYS.BBPS_SAMEDAY],
  ["/dashboard/bill-pay/bbps-2", SERVICE_KEYS.BBPS_BULKPE],
  ["/dashboard/bill-pay/credit-card", SERVICE_KEYS.BBPS_CREDIT_CARD],
  ["/dashboard/bill-pay/cc-pay", SERVICE_KEYS.RECHARGEKIT_CC],
  ["/dashboard/bill-pay", SERVICE_KEYS.BBPS],
  ["/dashboard/money-transfer", SERVICE_KEYS.DMT],
  ["/dashboard/travel", SERVICE_KEYS.TRAVEL],
  ["/dashboard/virtual-account", SERVICE_KEYS.VIRTUAL_ACCOUNT],
];

/**
 * Resolve a dashboard href to the service key that gates it, or null when the
 * page is not service-gated (wallet, reports, settings, ...).
 */
export function hrefToServiceKey(href: string): string | null {
  for (const [prefix, key] of SERVICE_HREF_PREFIXES) {
    if (href === prefix || href.startsWith(`${prefix}/`)) return key;
  }
  return null;
}

/**
 * The known rails seeded on a fresh DB. Re-seeding NEVER overrides an admin's
 * `enabled`/`note` choices (see {@link seedServiceRoutes}); it only backfills
 * presentation metadata and inserts missing rows.
 */
export const KNOWN_SERVICE_ROUTES: ServiceRouteSeed[] = [
  {
    key: SERVICE_KEYS.PAYOUT,
    name: "Payout (Same Day)",
    type: "SERVICE",
    kind: "PAYOUT",
    provider: "SAMEDAY",
    enabled: true,
    note: "Bank / UPI disbursals via the Same Day settlement API. Turning this off blocks new payout submissions immediately.",
    sortOrder: 10,
  },
  {
    key: SERVICE_KEYS.PG,
    name: "Payment Gateway",
    type: "SERVICE",
    kind: "PG",
    provider: "BULKPE",
    enabled: true,
    note: "Hosted checkout / UPI collections (BulkPe Simple PG) — powers instant wallet top-ups.",
    sortOrder: 20,
  },
  {
    key: SERVICE_KEYS.POS,
    name: "POS Terminals",
    type: "SERVICE",
    kind: "POS",
    provider: "SAMEDAY",
    enabled: true,
    note: "Same Day Solution POS fleet onboarding & settlements.",
    sortOrder: 30,
  },
  {
    key: SERVICE_KEYS.QR,
    name: "QR Payments",
    type: "SERVICE",
    kind: "QR",
    provider: "NPCI",
    enabled: true,
    note: "Static / dynamic UPI QR collections.",
    sortOrder: 40,
  },
  {
    key: SERVICE_KEYS.UPI,
    name: "UPI Collect",
    type: "SERVICE",
    kind: "UPI",
    provider: null,
    enabled: true,
    note: "Collect requests sent to a customer VPA.",
    sortOrder: 50,
  },
  {
    key: SERVICE_KEYS.DMT,
    name: "Money Transfer (DMT)",
    type: "SERVICE",
    kind: "DMT",
    provider: null,
    enabled: true,
    note: "Domestic money transfer (IMPS / NEFT / RTGS).",
    sortOrder: 60,
  },
  {
    key: SERVICE_KEYS.AEPS,
    name: "AePS / Aadhaar Pay",
    type: "SERVICE",
    kind: "AEPS",
    provider: null,
    enabled: true,
    note: "Aadhaar-enabled cash withdrawal & balance enquiry.",
    sortOrder: 70,
  },
  {
    key: SERVICE_KEYS.RECHARGE,
    name: "Recharges",
    type: "SERVICE",
    kind: "RECHARGE",
    provider: null,
    enabled: true,
    note: "Mobile / DTH / broadband recharges.",
    sortOrder: 80,
  },
  {
    key: SERVICE_KEYS.BBPS,
    name: "Bill Payments (BBPS) — master switch",
    type: "CONFIG",
    kind: "BBPS",
    provider: null,
    enabled: true,
    note: "Master on/off for all BBPS rails. Disabling this turns off BBPS-1, BBPS-2, and Credit Card together.",
    sortOrder: 89,
  },
  {
    key: SERVICE_KEYS.BBPS_SAMEDAY,
    name: "BBPS-Bharat BillPay",
    type: "SERVICE",
    kind: "BBPS",
    provider: "SAMEDAY",
    enabled: true,
    note: "Bill payments via Bharat BillPay — credit card bills, electricity, water, gas, and more.",
    sortOrder: 90,
  },
  {
    key: SERVICE_KEYS.BBPS_CREDIT_CARD,
    name: "Credit Card Bill Payment",
    type: "SERVICE",
    kind: "BBPS",
    provider: "SAMEDAY",
    enabled: true,
    note: "Dedicated credit card bill payment tab — Same Day Pay2New rail. Separate sidebar entry for credit card only.",
    sortOrder: 91,
  },
  {
    key: SERVICE_KEYS.BBPS_BULKPE,
    name: "Unified Bill Payment Platform",
    type: "SERVICE",
    kind: "BBPS",
    provider: "BULKPE",
    enabled: false,
    note: "Unified Bill Payment Platform (electricity, water, gas, and all non-credit-card categories). Enable once BulkPe IP whitelist is active.",
    sortOrder: 92,
  },
  {
    key: "bbps_bulkpe",
    name: "BulkPe BBPS Pricing (legacy key)",
    type: "CONFIG",
    kind: "BBPS",
    provider: "BULKPE",
    enabled: true,
    note: "Legacy pricing config row — retained for backward compatibility with scheme slabs pinned to this key.",
    sortOrder: 93,
  },
  {
    key: SERVICE_KEYS.RECHARGEKIT_CC,
    name: "Credit Card Bill Payment-2",
    type: "SERVICE",
    kind: "BBPS",
    provider: "SAMEDAY",
    enabled: true,
    note: "Direct credit card payment via Same Day RechargeKit (CC-2). Full 16-digit card number + bank details — no bill fetch needed.",
    sortOrder: 94,
  },
  {
    key: SERVICE_KEYS.TRAVEL,
    name: "Travel",
    type: "SERVICE",
    kind: "TRAVEL",
    provider: null,
    enabled: true,
    note: "Flight / hotel / bus / train bookings.",
    sortOrder: 100,
  },
  {
    key: SERVICE_KEYS.VERIFICATION,
    name: "eKYC Verification",
    type: "CONFIG",
    kind: "OTHER",
    provider: "EKYCHUB",
    enabled: true,
    note: "PAN / Aadhaar / bank verification via eKYC Hub.",
    sortOrder: 110,
  },
  {
    key: SERVICE_KEYS.VIRTUAL_ACCOUNT,
    name: "Virtual Account",
    type: "SERVICE",
    kind: "OTHER",
    provider: null,
    enabled: true,
    note: "Per-user virtual collection accounts.",
    sortOrder: 120,
  },
];

/**
 * Idempotently seed the known rails. Re-running is safe: admin-controlled
 * fields (`enabled`, `note`) are preserved on existing rows — only metadata
 * (name/type/kind/provider/sortOrder) is refreshed, and missing rows inserted.
 *
 * Accepts a Prisma client so it can run both from the Prisma seed (its own
 * `new PrismaClient()`) and from an API route (the shared lazy proxy).
 */
export async function seedServiceRoutes(
  client: PrismaClient
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;

  for (const r of KNOWN_SERVICE_ROUTES) {
    const existing = await client.serviceRoute.findUnique({
      where: { key: r.key },
      select: { id: true },
    });

    await client.serviceRoute.upsert({
      where: { key: r.key },
      update: {
        name: r.name,
        type: r.type,
        kind: r.kind,
        provider: r.provider ?? null,
        sortOrder: r.sortOrder,
      },
      create: {
        key: r.key,
        name: r.name,
        type: r.type,
        kind: r.kind,
        provider: r.provider ?? null,
        enabled: r.enabled,
        note: r.note ?? null,
        sortOrder: r.sortOrder,
      },
    });

    if (existing) updated++;
    else created++;
  }

  return { created, updated };
}
