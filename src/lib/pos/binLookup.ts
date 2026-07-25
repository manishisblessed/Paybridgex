import { prisma } from "@/lib/db";
import { checkCardBin, ekychubConfigured } from "@/lib/partners/ekychub";
import { generateRefId } from "@/lib/utils";

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
 * Look up card BIN classification. Checks the local cache first;
 * on miss, calls eKYC Hub and caches the result permanently (BINs are static).
 * Returns null if the lookup fails or the provider is not configured.
 */
export async function lookupBin(cardNumber: string): Promise<BinResult | null> {
  const bin = cardNumber.replace(/\D/g, "").slice(0, 6);
  if (bin.length < 6) return null;

  const cached = await prisma.cardBinCache.findUnique({ where: { bin } });
  if (cached) {
    return {
      bin: cached.bin,
      cardNetwork: cached.cardNetwork,
      cardType: cached.cardType,
      cardLevel: cached.cardLevel,
      country: cached.country,
      issuerBank: cached.issuerBank,
    };
  }

  if (!ekychubConfigured()) return null;

  const result = await checkCardBin({ card: bin, orderid: generateRefId("BIN") });
  if (!result.ok) return null;

  const data = result.data;
  const entry: BinResult = {
    bin: data.bin || bin,
    cardNetwork: data.cardNetwork || "",
    cardType: data.cardType || "",
    cardLevel: data.cardLevel || "",
    country: data.country || "",
    issuerBank: data.issuerBank || "",
  };

  await prisma.cardBinCache.upsert({
    where: { bin },
    update: {},
    create: {
      bin,
      cardNetwork: entry.cardNetwork,
      cardType: entry.cardType,
      cardLevel: entry.cardLevel,
      country: entry.country,
      issuerBank: entry.issuerBank,
    },
  });

  return entry;
}
