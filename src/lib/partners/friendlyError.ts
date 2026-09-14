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
 * Light, conservative heuristics on the raw message for genuinely useful,
 * non-sensitive operator feedback. Anything not matched falls through to the
 * context default — we never return the raw text itself.
 */
function heuristicFromMessage(raw: string): string | null {
  const m = raw.toLowerCase();

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
  fetch: "We couldn't load this right now. Please try again in a moment.",
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
