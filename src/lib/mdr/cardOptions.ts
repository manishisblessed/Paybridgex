// Card instrument / network / classification options shared by the Brands MDR
// rate editor and the scheme slab modal. Pure constants + tiny pure helpers —
// safe to import from client components (no server-only dependencies).

/**
 * Instrument selector → (paymentMode, cardType) mapping for an MDR row. The two
 * dimensions are kept separate on the model (paymentMode = CARD/UPI, cardType =
 * CREDIT/DEBIT/PREPAID) so this collapses them into one friendly dropdown.
 */
export const CARD_INSTRUMENTS = [
  { value: "", label: "Any", paymentMode: "*", cardType: null as string | null },
  { value: "CARD_DEBIT", label: "Debit Card", paymentMode: "CARD", cardType: "DEBIT" },
  { value: "CARD_CREDIT", label: "Credit Card", paymentMode: "CARD", cardType: "CREDIT" },
  { value: "CARD_PREPAID", label: "Prepaid Card", paymentMode: "CARD", cardType: "PREPAID" },
  { value: "UPI", label: "UPI", paymentMode: "UPI", cardType: null },
] as const;

/** Card networks (brandType dimension). */
export const CARD_NETWORKS = ["VISA", "MASTERCARD", "RUPAY", "AMEX", "DINERS"] as const;

/**
 * Canonical card tiers (classification dimension). Mirrors CARD_LEVELS in
 * src/lib/pos/binLookup.ts so a pinned tier here canonicalises to itself when
 * matched against feed labels like "VISA PLATINUM".
 */
export const CARD_CLASSIFICATIONS = [
  "WORLD ELITE",
  "INFINITE",
  "SIGNATURE",
  "PLATINUM",
  "TITANIUM",
  "CORPORATE",
  "COMMERCIAL",
  "BUSINESS",
  "PURCHASE",
  "REWARDS",
  "PREMIUM",
  "WORLD",
  "GOLD",
  "CLASSIC",
  "STANDARD",
  "ELECTRON",
  "MAESTRO",
  "PREPAID",
] as const;

/** Instrument select value → the pair of dimensions it maps to. */
export function instrumentToDims(value: string): { paymentMode: string; cardType: string | null } {
  const found = CARD_INSTRUMENTS.find((i) => i.value === value);
  return found ? { paymentMode: found.paymentMode, cardType: found.cardType } : { paymentMode: "*", cardType: null };
}

/** Derive the instrument select value from a stored (paymentMode, cardType). */
export function dimsToInstrument(
  paymentMode: string | null | undefined,
  cardType: string | null | undefined
): string {
  const pm = (paymentMode ?? "").toUpperCase();
  const ct = (cardType ?? "").toUpperCase();
  if (pm === "UPI") return "UPI";
  if (ct === "DEBIT") return "CARD_DEBIT";
  if (ct === "CREDIT") return "CARD_CREDIT";
  if (ct === "PREPAID") return "CARD_PREPAID";
  return "";
}

/** True when the instrument is a card (networks / classification apply). */
export function instrumentIsCard(value: string): boolean {
  return value.startsWith("CARD_");
}
