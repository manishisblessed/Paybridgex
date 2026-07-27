import { prisma } from "@/lib/db";
import { checkCardBin, ekychubConfigured } from "@/lib/partners/ekychub";
import { generateRefId } from "@/lib/utils";
import { logger } from "@/lib/logger";
import type { BinResult } from "@/lib/pos/classification";

// Pure, client-safe helpers now live in `classification.ts`. Re-exported here so
// existing server-side importers (enrich, MDR resolver, ingest, ...) keep the
// same `@/lib/pos/binLookup` import path.
export type { BinResult } from "@/lib/pos/classification";
export {
  classificationFromBin,
  CARD_LEVELS,
  canonicalCardLevel,
  canonicalNetwork,
  posClassificationLabel,
} from "@/lib/pos/classification";

// The eKYC Hub BIN checker charges per call and rejects with "Low balance in
// API" when the account is out of funds — which silently zeroes out card
// classification enrichment. Throttle the alarm so a large batch of lookups
// logs it once, not hundreds of times.
let lastLowBalanceLogAt = 0;
const LOW_BALANCE_LOG_INTERVAL_MS = 5 * 60 * 1000;

// Timestamp (ms) of the most recent low-balance rejection, updated on EVERY
// occurrence (not throttled). Callers capture a `Date.now()` before a batch of
// lookups and compare against this to tell whether THIS request hit a low
// balance — used to surface a degraded-enrichment banner in the UI.
let lastLowBalanceAt = 0;

/** Epoch ms of the last eKYC Hub low-balance BIN rejection (0 if never). */
export function getBinLastLowBalanceAt(): number {
  return lastLowBalanceAt;
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
  if (!result.ok) {
    const message = result.message ?? "";
    // Surface the actionable case — an empty eKYC Hub wallet blocks ALL
    // classification enrichment until topped up — as a throttled warning.
    if (/balance/i.test(message)) {
      const now = Date.now();
      lastLowBalanceAt = now;
      if (now - lastLowBalanceLogAt > LOW_BALANCE_LOG_INTERVAL_MS) {
        lastLowBalanceLogAt = now;
        logger.warn(
          { provider: "EKYCHUB", api: "bin", reason: message },
          "Card BIN lookup blocked: eKYC Hub API balance is low — POS card classification cannot be enriched until the account is topped up"
        );
      }
    } else {
      logger.debug({ provider: "EKYCHUB", api: "bin", reason: message }, "Card BIN lookup failed");
    }
    return null;
  }

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
