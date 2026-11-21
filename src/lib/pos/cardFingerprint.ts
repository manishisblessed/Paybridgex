import { createHash } from "crypto";

/**
 * Deterministic card identity fingerprint for duplicate swipe detection.
 *
 * The partner provides only a masked PAN (e.g. "XXXX XXXX XXXX 1234"), never a
 * card token or full PAN hash. We combine every available card-identity dimension
 * into a SHA-256 to minimize collision risk:
 *   - masked PAN (last 4 digits)
 *   - card brand (VISA / MASTERCARD / RUPAY / ...)
 *   - card type (CREDIT / DEBIT / PREPAID)
 *   - issuing bank (when available)
 *
 * KNOWN LIMITATION: Two different cards from the same issuing bank, same brand,
 * same type, with the same last 4 digits WILL produce the same fingerprint. This
 * is a false positive, not a false negative — it may flag a legitimate pair of
 * swipes from two different cards. The admin review step handles this.
 *
 * Returns null when the minimum fields (masked PAN + card brand) are absent
 * (e.g. UPI/QR transactions — these cannot be fingerprinted for card-dupe detection).
 */
export function computeCardFingerprint(input: {
  cardNumber?: string | null;
  cardBrand?: string | null;
  cardType?: string | null;
  issuingBank?: string | null;
}): string | null {
  const pan = (input.cardNumber ?? "").replace(/\D/g, "");
  const last4 = pan.slice(-4);
  if (last4.length < 4) return null;

  const brand = (input.cardBrand ?? "").trim().toUpperCase();
  if (!brand) return null;

  const parts = [
    last4,
    brand,
    (input.cardType ?? "").trim().toUpperCase(),
    (input.issuingBank ?? "").trim().toUpperCase(),
  ];

  return createHash("sha256").update(parts.join("|")).digest("hex");
}

/**
 * Compute the IST business date for a given timestamp. The business date is the
 * calendar date in Asia/Kolkata timezone (UTC+05:30).
 */
export function istBusinessDate(date: Date): Date {
  const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
}
