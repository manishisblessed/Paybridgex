/**
 * Partner/provider error → user-friendly message translation.
 *
 * Upstream rails (Same Day BBPS/RechargeKit/Payout, recharge, AePS, DMT, PAN)
 * return raw, machine-oriented `{ code, message }` failures — things like
 * "Recharge amount restricted by operator (code 1)" or "Insufficient partner
 * wallet balance". Showing those verbatim to a retailer is confusing at best
 * and damaging at worst (a low PARTNER float is OUR problem, never the
 * retailer's — surfacing it makes the platform look broken).
 *
 * This is the SINGLE place that decides what an end user sees. Rules:
 *   - NEVER echo raw provider text. Default to a safe, reassuring message.
 *   - Sensitive codes (our float/auth/config) ALWAYS collapse to a generic
 *     message and should be alerted to ops via {@link isSensitivePartnerCode}.
 *   - Known codes map to specific, actionable guidance.
 *   - A few safe heuristics turn genuinely useful operator feedback (amount
 *     limits / restrictions) into clean wording, stripping "(code N)" noise.
 *
 * Callers keep the RAW `code`/`message`/`response` for logs, audit trails and
 * reconciliation — only the user-facing string is sanitized here.
 */

export type FriendlyContext =
  | "payment" // bill pay / CC / recharge / AePS / DMT — wallet auto-refund wording
  | "payout" // money out — held funds are safe / released
  | "fetch" // bill fetch / preview / operators / status — nothing debited yet
  | "generic"; // wallet top-up and everything else

/**
 * Codes that reveal OUR platform's internal state (partner float, auth, config,
 * IP allowlist, signature). These must ALWAYS become a generic message so the
 * retailer never thinks it's their fault — and SHOULD trigger an ops alert so we
 * fix the real cause (e.g. top up the Same Day float).
 */
const SENSITIVE_CODES = new Set([
  "INSUFFICIENT_BALANCE", // partner (company) wallet/float is low — NOT the user's wallet
  "LOW_BALANCE",
  "WALLET_FROZEN",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "AUTH_FAILED",
  "AUTHENTICATION_FAILED",
  "INVALID_API_KEY",
  "INVALID_SIGNATURE",
  "SIGNATURE_MISMATCH",
  "IP_NOT_WHITELISTED",
  "IP_BLOCKED",
  "NOT_CONFIGURED",
  "CONFIG_ERROR",
]);

/**
 * True when `code` indicates an internal platform problem that must never be
 * shown to end users and should page ops. Money-path callers use this to fire a
 * best-effort {@link sendOpsAlert} while still returning a friendly message.
 */
export function isSensitivePartnerCode(code?: string | null): boolean {
  if (!code) return false;
  return SENSITIVE_CODES.has(code.trim().toUpperCase());
}

/** Known partner/internal codes → specific, user-actionable messages. */
const CODE_MESSAGES: Record<string, string> = {
  // Pay2New: the bill-fetch reference is single-use. Once a pay against it
  // failed and was refunded, every replay returns this — the retailer MUST
  // fetch a fresh bill. Reassure (no money lost, not their fault) instead of the
  // old "bill session expired" wording, which read like a bug on our side.
  PAYMENT_REFUNDED:
    "The previous attempt didn't go through and any amount debited has been refunded to your wallet. Please tap “Fetch bill” again to retry.",
  // Pay2New definitive decline (biller/issuer temporarily down). Funds are
  // auto-refunded; retrying the same ref won't help until the biller is back.
  PAYMENT_FAILED:
    "This bank isn't responding right now, so the payment couldn't be completed. Any amount debited is auto-refunded to your wallet — please try again in a little while, or choose another card issuer.",
  RATE_LIMITED: "We're a bit busy right now. Please wait a moment and try again.",
  NETWORK:
    "We couldn't reach the payment network. Please check your connection and try again.",
  PARTNER_REQUEST_FAILED:
    "We couldn't reach the payment network. Please try again in a moment.",
  PARTNER_TIMEOUT:
    "The request is taking longer than usual. Please check your transaction history before trying again.",
  INVALID_RESPONSE:
    "We received an unexpected response from the network. Please try again shortly.",
  UPSTREAM_ERROR: "The service is temporarily unavailable. Please try again shortly.",
  INVALID_MOBILE: "Please enter a valid 10-digit mobile number.",
  INVALID_CARD: "Please re-check the card number and try again.",
  INVALID_ACCOUNT: "Please re-check the account number and try again.",
  INVALID_IFSC: "Please re-check the IFSC code and try again.",
  BAD_PARAMS: "Some details look incorrect. Please review and try again.",
  UNSUPPORTED_CATEGORY: "This option isn't available right now.",
};

/**
 * "No dues" — a legitimate, common bill-FETCH outcome: the bill for this period
 * is already paid, so the biller returns no bill. Same Day wraps this as
 * FETCH_BILL_ERROR: "Payment received for the billing period - no bill due".
 * Detected centrally so the API can tag it and the UI can show a friendly
 * "no bill due" notice instead of a red error.
 */
const NO_BILL_DUE_RE =
  /\b(no\s+bill\s+due|no\s+dues?\b|no\s+outstanding|already\s+paid|payment\s+received|nothing\s+(is\s+)?due|no\s+amount\s+due)\b/;

/** True when a bill-fetch failure actually means "this card has no bill due". */
export function isNoBillDue(message?: string | null): boolean {
  return !!message && NO_BILL_DUE_RE.test(message.toLowerCase());
}

/** The user-facing "no bill due" notice (shared by web + mobile). */
export const NO_BILL_DUE_MESSAGE =
  "No bill is currently due for this card — it looks like this billing period has already been paid.";

/**
 * Light, conservative heuristics on the raw message for genuinely useful,
 * non-sensitive operator feedback. Anything not matched falls through to the
 * context default — we never return the raw text itself.
 */
function heuristicFromMessage(raw: string): string | null {
  const m = raw.toLowerCase();

  // "No dues" — surface it plainly instead of a scary generic error, otherwise
  // retailers keep retrying a card that has nothing to pay.
  if (NO_BILL_DUE_RE.test(m)) {
    return NO_BILL_DUE_MESSAGE;
  }

  // Same Day platform / service down (their message literally points users at
  // "support") — this is a payment-service outage, not the retailer's fault and
  // not a specific bank. Say so plainly so there's no confusion.
  if (
    /\b(drop a message to.*support|gateway|internal server error)\b/.test(m) ||
    /\bservice\s+(is\s+)?(temporarily\s+)?(down|unavailable)\b/.test(m)
  ) {
    return "The bill payment service is temporarily down. Please try again in a little while — you won't be charged.";
  }

  // A specific biller/bank is temporarily unavailable on BBPS.
  if (
    /\b(temporarily\s+(down|unavailable)|try\s+again\s+later)\b/.test(m)
  ) {
    return "This bank isn't responding right now. Please try again shortly, or choose another card issuer.";
  }

  // No record for the supplied identifiers (wrong card last-4 / mobile).
  if (/\b(no\s+record|not\s+registered|no\s+bill\s+found|invalid\s+customer)\b/.test(m)) {
    return "No bill found for these details. Please re-check the card's last 4 digits and the registered mobile number.";
  }

  if (
    /\b(restrict|not allowed|not permitted|declin|reject)/.test(m) &&
    /\b(operator|biller|bank|issuer)/.test(m)
  ) {
    return "This operator can't accept this payment right now. Try a different amount, or try again later.";
  }
  if (/\b(minimum|min\.?\s*amount|at least|too low|below)/.test(m)) {
    return "The amount is below the minimum allowed for this operator. Please enter a higher amount.";
  }
  if (/\b(maximum|max\.?\s*amount|exceed|too high|above|limit)/.test(m)) {
    return "The amount is above the maximum allowed for this operator. Please enter a lower amount.";
  }
  if (/\binvalid\b.*\b(account|card|number|ifsc|mobile|detail)/.test(m)) {
    return "Some details look incorrect. Please review the information and try again.";
  }
  if (/\bduplicate\b/.test(m)) {
    return "This looks like a duplicate request. Please check your transaction history before trying again.";
  }
  return null;
}

const DEFAULTS: Record<FriendlyContext, string> = {
  payment:
    "We couldn't complete this payment right now. Any amount debited is automatically refunded to your wallet — please try again shortly.",
  payout:
    "We couldn't process this payout right now. Your money is safe — please try again shortly or contact support if it persists.",
  fetch:
    "We couldn't fetch this bill right now — the bank or payment service didn't respond. Please try again in a little while. You haven't been charged.",
  generic: "Something went wrong. Please try again shortly, or contact support if it persists.",
};

/**
 * Translate a partner error into a safe, user-friendly message.
 *
 * @param code       Raw partner/internal error code (e.g. "INSUFFICIENT_BALANCE").
 * @param rawMessage Raw partner message (never returned verbatim).
 * @param ctx        Tunes the fallback wording to the flow. Defaults to "payment".
 */
export function friendlyPartnerError(
  code?: string | null,
  rawMessage?: string | null,
  ctx: FriendlyContext = "payment"
): string {
  const normCode = (code ?? "").trim().toUpperCase();

  // 1. Sensitive → always generic (never leak internal/float/auth state).
  if (isSensitivePartnerCode(normCode)) return DEFAULTS[ctx];

  // 2. Known code → explicit, actionable message.
  if (normCode && CODE_MESSAGES[normCode]) return CODE_MESSAGES[normCode];

  // 3. Safe heuristic on the raw message (operator limits/restrictions only).
  const raw = (rawMessage ?? "").trim();
  if (raw) {
    const h = heuristicFromMessage(raw);
    if (h) return h;
  }

  // 4. Default — never echo raw provider text.
  return DEFAULTS[ctx];
}
