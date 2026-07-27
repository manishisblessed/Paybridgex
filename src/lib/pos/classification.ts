// ---------------------------------------------------------------------------
// Pure, client-safe card-classification helpers.
//
// Deliberately free of server-only imports (no prisma / partner clients) so it
// can be used from React client components as well as server code. The
// prisma-backed BIN lookup lives in `binLookup.ts`, which re-exports these.
// ---------------------------------------------------------------------------

export interface BinResult {
  bin: string;
  cardNetwork: string;
  cardType: string;
  cardLevel: string;
  country: string;
  issuerBank: string;
}

/**
 * Build a human-readable card classification label from a BIN lookup, used as a
 * fallback when the acquirer feed doesn't provide `card_classification`.
 * Prefers `network + level` (e.g. "VISA PLATINUM") to match the style of the
 * partner API's classification strings, falling back to level or type alone.
 * Returns undefined when there's nothing meaningful to show.
 */
export function classificationFromBin(bin: BinResult): string | undefined {
  const label = [bin.cardNetwork, bin.cardLevel]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  const fallback = label || bin.cardLevel.trim() || bin.cardType.trim();
  return fallback ? fallback.toUpperCase() : undefined;
}

/**
 * Known card-tier levels, ordered most-specific first so multi-word tiers match
 * before their single-word substrings (e.g. "WORLD ELITE" before "WORLD").
 */
export const CARD_LEVELS = [
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

/**
 * Reduce any classification string to its canonical card tier for matching.
 *
 * Feeds and BIN lookups label the same tier inconsistently ("VISA PLATINUM",
 * "Visa Platinum", "PLATINUM MASTERCARD", "World Mastercard Card"), so an exact
 * string compare against an MDR slab pinned to a bare tier ("PLATINUM") would
 * never match. This collapses all of those to the underlying tier token so
 * pricing resolves regardless of the network prefix or word order. Strings with
 * no recognised tier are returned normalized (uppercased, single-spaced) so they
 * still compare exactly.
 */
export function canonicalCardLevel(value: string | null | undefined): string {
  const s = (value ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  if (!s) return "";
  for (const level of CARD_LEVELS) {
    if (s === level || s.includes(level)) return level;
  }
  return s;
}

/**
 * Reduce a card-network label to a canonical token so pricing matches
 * regardless of how the feed formats it. Acquirers send "MASTER_CARD",
 * "Master Card", "VISA CREDIT", "American Express", etc.; this collapses them
 * to VISA / MASTERCARD / RUPAY / AMEX / DINERS / MAESTRO. Unrecognised values
 * are returned upper-cased with non-letters stripped so they still compare
 * consistently.
 */
export function canonicalNetwork(value: string | null | undefined): string {
  const s = (value ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  if (!s) return "";
  if (s.includes("MASTER")) return "MASTERCARD";
  if (s.includes("VISA")) return "VISA";
  if (s.includes("RUPAY")) return "RUPAY";
  if (s.includes("AMEX") || s.includes("AMERICANEXPRESS")) return "AMEX";
  if (s.includes("DINER")) return "DINERS";
  if (s.includes("MAESTRO")) return "MAESTRO";
  return s;
}

/**
 * Classification values the feed returns that carry no real tier information —
 * treated as "no classification" so the display falls back to something useful.
 */
const NON_INFORMATIVE_CLASSIFICATION = new Set(["OTHER", "UNKNOWN", "NA", "N/A", "-", ""]);

/**
 * Display label for a POS transaction's card classification, with a graceful
 * fallback so no CARD row is ever blank:
 *
 *  1. If the feed / BIN lookup gave a real tier ("VISA PLATINUM", "SIGNATURE"),
 *     show it as-is.
 *  2. RUPAY cards — whose PANs are typically masked to the last 4 digits so no
 *     BIN can be derived, and whose feed classification is usually "OTHER" —
 *     show simply "RUPAY".
 *  3. Otherwise fall back to the (normalised) network + card type,
 *     e.g. "VISA CREDIT", "MASTERCARD DEBIT".
 *
 * Returns null for non-CARD modes (UPI / QR / cash have no classification).
 * This is a DISPLAY helper only — it never mutates `card_classification`, so
 * MDR/pricing resolution keeps using the true feed/BIN value.
 */
export function posClassificationLabel(txn: {
  payment_mode?: string | null;
  card_classification?: string | null;
  card_brand?: string | null;
  card_type?: string | null;
}): string | null {
  if ((txn.payment_mode ?? "").toUpperCase() !== "CARD") return null;

  const explicit = (txn.card_classification ?? "").trim();
  if (explicit && !NON_INFORMATIVE_CLASSIFICATION.has(explicit.toUpperCase())) {
    return explicit;
  }

  const network = canonicalNetwork(txn.card_brand);
  if (network === "RUPAY") return "RUPAY";

  const type = (txn.card_type ?? "").trim().toUpperCase();
  if (network) return type ? `${network} ${type}` : network;

  const brand = (txn.card_brand ?? "").trim();
  const label = [brand, type].filter(Boolean).join(" ").trim();
  return label || null;
}
