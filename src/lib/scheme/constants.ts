/**
 * ServiceCode values usable in scheme slabs. Kept as a const tuple so it can
 * drive both a zod enum (API validation) and the admin UI service picker.
 * Must stay in sync with the Prisma `ServiceCode` enum.
 */
export const SERVICE_CODES = [
  "AEPS_BALANCE",
  "AEPS_WITHDRAW",
  "AEPS_MINI_STMT",
  "DMT_IMPS",
  "DMT_NEFT",
  "DMT_RTGS",
  "UPI_COLLECT",
  "UPI_PAYOUT",
  "PAYOUT",
  "KNTEER_PAYOUT",
  "WALLET_TOPUP",
  "WALLET_WITHDRAW",
  "RECHARGE_MOBILE",
  "RECHARGE_DTH",
  "RECHARGE_BROADBAND",
  "BILL_ELECTRICITY",
  "BILL_WATER",
  "BILL_GAS",
  "BILL_CREDIT_CARD",
  "BILL_EDUCATION",
  "BILL_INSURANCE",
  "TRAVEL_FLIGHT",
  "TRAVEL_HOTEL",
  "TRAVEL_BUS",
  "TRAVEL_TRAIN",
  "PAN_CARD",
  "INSURANCE",
] as const;

export type ServiceCodeValue = (typeof SERVICE_CODES)[number];

/**
 * Human-friendly display label for a service code.
 * Use this instead of `code.replace(/_/g, " ")` so sensitive internal names
 * (e.g. "KNTEER PAYOUT") never appear in the UI.
 */
const SERVICE_LABEL_MAP: Record<string, string> = {
  KNTEER_PAYOUT: "Bank Transfer",
};

export function serviceLabel(code: string): string {
  return SERVICE_LABEL_MAP[code] ?? code.replace(/_/g, " ");
}

/** Human-friendly grouping label for a service code (for the UI). */
export function serviceGroup(code: string): string {
  if (code.startsWith("AEPS")) return "AePS";
  if (code === "KNTEER_PAYOUT") return "Bank Transfer";
  if (code === "PAYOUT") return "Payout";
  if (code.startsWith("DMT")) return "Money Transfer";
  if (code.startsWith("UPI")) return "UPI";
  if (code.startsWith("WALLET")) return "Wallet";
  if (code.startsWith("RECHARGE")) return "Recharge";
  if (code.startsWith("BILL")) return "Bill Payments";
  if (code.startsWith("TRAVEL")) return "Travel";
  return "Other";
}

/**
 * Icon-wise service families for the scheme-management UI (Same Day style):
 * each family gets an icon button on the scheme card that opens a slab modal
 * scoped to its services, plus an expandable slab-table section.
 * `routeKind` maps the family to ServiceRoute.kind for the provider dropdown.
 */
export const SERVICE_FAMILIES = [
  {
    key: "BBPS",
    label: "BBPS Bills",
    routeKind: "BBPS",
    services: [
      "BILL_ELECTRICITY",
      "BILL_WATER",
      "BILL_GAS",
      "BILL_CREDIT_CARD",
      "BILL_EDUCATION",
      "BILL_INSURANCE",
    ],
  },
  {
    key: "PAYOUT",
    label: "Payout",
    routeKind: "PAYOUT",
    // Bank Transfer (Knteer) rides the PAYOUT rail-kind for vendor rate cards
    // (serviceKind="PAYOUT"), but is priced from its OWN scheme slabs via the
    // distinct KNTEER_PAYOUT ServiceCode — so admins add separate slabs for it.
    services: ["PAYOUT", "KNTEER_PAYOUT"],
  },
] as const;

export type ServiceFamily = (typeof SERVICE_FAMILIES)[number];

/**
 * "Charge-driven" services (BBPS bills + Payout) earn on a flat, charge-first
 * model: a parent's margin is their charge markup MINUS the commission they pass
 * down to the child (the child's commission is funded out of the markup, never a
 * separate commission pool). This differs from pool-based services (AePS/DMT),
 * where the platform allocates a commission that shrinks down the chain and each
 * tier keeps markup PLUS the retained commission.
 */
export const CHARGE_DRIVEN_SERVICE_CODES: ReadonlySet<string> = new Set<string>([
  ...(SERVICE_FAMILIES.find((f) => f.key === "BBPS")!.services as readonly string[]),
  "PAYOUT",
  "KNTEER_PAYOUT",
]);

/** True when a service uses the charge-markup-minus-commission margin model. */
export function isChargeDrivenService(code: string): boolean {
  return CHARGE_DRIVEN_SERVICE_CODES.has(code);
}

/** Legacy service codes that belong to the PAYOUT family (pre-unification). */
const PAYOUT_LEGACY = new Set(["DMT_IMPS", "DMT_NEFT", "DMT_RTGS", "UPI_PAYOUT"]);

/** Family a service code belongs to (falls back to PAYOUT for legacy codes). */
export function familyOf(code: string): ServiceFamily {
  return (
    SERVICE_FAMILIES.find((f) => (f.services as readonly string[]).includes(code)) ??
    (PAYOUT_LEGACY.has(code) ? SERVICE_FAMILIES.find((f) => f.key === "PAYOUT")! : SERVICE_FAMILIES[0])
  );
}

/**
 * Who assigns a scheme. In the flat model, admin assigns all schemes directly.
 */
export function schemeAssignerLabel(_role: string | null | undefined): string {
  return "admin";
}
