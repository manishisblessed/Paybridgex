/**
 * BBPS (Same Day / Pay2New) rail health — real-time, in-process signal.
 *
 * WHY: Credit-card bill fetch/pay failures are almost always UPSTREAM (Same Day
 * platform down, or a specific bank/biller not responding on BBPS) — not our
 * bug. But to a retailer a red error looks like OUR fault. This module turns the
 * raw stream of fetch/pay outcomes into a single, honest health verdict the UI
 * can show as a calm banner ("payment service is temporarily down" vs "this
 * bank is facing issues — choose another"), and the worker can alert ops on.
 *
 * Design:
 *   - EVERY live user-facing Pay2New call (bill/fetch, bill/pay) reports its
 *     outcome here via {@link recordBbpsOutcome} from the shared transport
 *     (sameday-core). Recon status polls are NOT recorded (not user-facing).
 *   - A small in-memory ring buffer holds the last few minutes of outcomes.
 *     This is per-process (we run a 2-node web cluster) which is fine: a real
 *     outage shows on every node, and nothing here is money-authoritative — the
 *     ledger is. The worker's DB-based monitor is the accurate alerting path.
 *   - Failures are CLASSIFIED so we never blame the bank for a platform outage
 *     (or vice-versa), and never count a user's typo / a stale-session replay as
 *     a rail failure.
 *
 * Never throws — a health-tracking hiccup must never affect a payment.
 */

export type BbpsFailureKind =
  | "API_DOWN" // Same Day platform / transport / auth / float — OUR side of the rail
  | "BILLER_DOWN" // the bank/biller is not responding or declined upstream
  | "USER_ERROR" // wrong card last-4 / mobile, bad params — not a rail problem
  | "STALE_SESSION"; // replay of an already-failed+refunded bill_fetch_ref

export type BbpsHealthStatus = "OK" | "DEGRADED" | "API_DOWN";

export type BbpsHealthSnapshot = {
  status: BbpsHealthStatus;
  /** Short, user-safe reason (null when OK). */
  reason: string | null;
  /** Biller/product codes currently failing hard at the bank's end. */
  downBillers: string[];
  /** Minutes of history this verdict is based on. */
  windowMin: number;
  /** How many scored (non-user, non-replay) outcomes were in the window. */
  sample: number;
  /** Fraction (0..1) of scored outcomes that failed. */
  failRate: number;
};

type Outcome = {
  t: number;
  ok: boolean;
  step: "fetch" | "pay";
  biller: string | null;
  kind: BbpsFailureKind | null; // null when ok
};

// ---- tunables (env-overridable; sensible defaults for production) ----
const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};
const WINDOW_MS = num(process.env.BBPS_HEALTH_WINDOW_MS, 10 * 60_000);
const MIN_SAMPLE = num(process.env.BBPS_HEALTH_MIN_SAMPLE, 6);
const DEGRADED_RATE = num(process.env.BBPS_HEALTH_DEGRADED_RATE, 0.45);
const API_DOWN_RATE = num(process.env.BBPS_HEALTH_APIDOWN_RATE, 0.6);
const API_DOWN_SHARE = num(process.env.BBPS_HEALTH_APIDOWN_SHARE, 0.5);
const BILLER_MIN_FAILS = num(process.env.BBPS_HEALTH_BILLER_MIN_FAILS, 3);
const BILLER_DOWN_RATE = num(process.env.BBPS_HEALTH_BILLER_RATE, 0.6);
const RING_MAX = 800;

const ring: Outcome[] = [];

/** Named codes that mean the failure is on OUR/the platform side, never the user's. */
const API_DOWN_CODES = new Set([
  "INSUFFICIENT_BALANCE", "LOW_BALANCE", "WALLET_FROZEN",
  "UNAUTHORIZED", "FORBIDDEN", "AUTH_FAILED", "AUTHENTICATION_FAILED",
  "INVALID_API_KEY", "INVALID_SIGNATURE", "SIGNATURE_MISMATCH",
  "IP_NOT_WHITELISTED", "IP_BLOCKED", "NOT_CONFIGURED", "CONFIG_ERROR",
  "NETWORK", "PARTNER_REQUEST_FAILED", "PARTNER_TIMEOUT",
  "INVALID_RESPONSE", "UPSTREAM_ERROR", "RATE_LIMITED", "EXCEPTION",
]);

const USER_ERROR_CODES = new Set([
  "BAD_PARAMS", "INVALID_MOBILE", "INVALID_CARD", "INVALID_ACCOUNT",
  "INVALID_IFSC", "MISSING_BILL_FETCH_REF", "UNSUPPORTED_CATEGORY",
]);

/**
 * Classify a raw partner failure into a health/messaging kind. Pure + exported
 * so the API routes and the worker monitor all bucket failures identically.
 */
export function classifyBbpsFailure(
  code?: string | null,
  message?: string | null
): BbpsFailureKind {
  const c = (code ?? "").trim().toUpperCase();
  const m = (message ?? "").toLowerCase();

  // Stale, single-use bill_fetch_ref replayed after a prior failure+refund.
  if (c === "PAYMENT_REFUNDED" || /previous payment.*(refunded|failed)|fetch a new bill/.test(m)) {
    return "STALE_SESSION";
  }

  // Platform / transport / auth / float — our side of the rail, or Same Day's.
  if (API_DOWN_CODES.has(c)) return "API_DOWN";
  if (/^HTTP_(5\d\d|408|429)$/.test(c)) return "API_DOWN";
  if (/\b(service\s+(is\s+)?(temporarily\s+)?(down|unavailable)|drop a message to.*support|gateway|internal server error)\b/.test(m)) {
    return "API_DOWN";
  }

  // Genuine user input problems — never a rail-health signal.
  if (USER_ERROR_CODES.has(c)) return "USER_ERROR";
  if (/\b(invalid customer|incorrect.*(customer|account|card)|no record|not registered|no bill found|invalid (account|card|mobile|number))\b/.test(m)) {
    return "USER_ERROR";
  }

  // Bank / biller side: not responding or declined upstream on BBPS.
  if (c === "PAYMENT_FAILED" || c === "FETCH_BILL_ERROR") return "BILLER_DOWN";
  if (/\b(unable to get bill|from biller|biller|transaction failed|declined|temporarily unavailable)\b/.test(m)) {
    return "BILLER_DOWN";
  }

  // Unknown upstream failure — treat as biller-side (we'd have a named code for
  // our own problems), so it contributes to a "degraded" verdict conservatively.
  return "BILLER_DOWN";
}

/** Record one live fetch/pay outcome. Best-effort; never throws. */
export function recordBbpsOutcome(o: {
  ok: boolean;
  step: "fetch" | "pay";
  billerCode?: string | null;
  code?: string | null;
  message?: string | null;
}): void {
  try {
    const kind = o.ok ? null : classifyBbpsFailure(o.code, o.message);
    ring.push({
      t: Date.now(),
      ok: o.ok,
      step: o.step,
      biller: (o.billerCode ?? "").trim() || null,
      kind,
    });
    if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
  } catch {
    /* never let health tracking affect a payment */
  }
}

/** Current rail health verdict from the in-process window. Never throws. */
export function getBbpsHealthSnapshot(): BbpsHealthSnapshot {
  const empty: BbpsHealthSnapshot = {
    status: "OK",
    reason: null,
    downBillers: [],
    windowMin: Math.round(WINDOW_MS / 60_000),
    sample: 0,
    failRate: 0,
  };
  try {
    const cutoff = Date.now() - WINDOW_MS;
    const recent = ring.filter((e) => e.t >= cutoff);

    // Score only outcomes that actually reflect rail health: successes plus
    // API_DOWN / BILLER_DOWN failures. User typos and stale-ref replays are
    // excluded so they can't manufacture a false outage (the replay storm was
    // the biggest contributor to the scary error volume users saw).
    const scored = recent.filter(
      (e) => e.ok || e.kind === "API_DOWN" || e.kind === "BILLER_DOWN"
    );
    const sample = scored.length;
    if (sample < MIN_SAMPLE) return empty;

    const fails = scored.filter((e) => !e.ok);
    const failRate = fails.length / sample;
    const apiFails = fails.filter((e) => e.kind === "API_DOWN").length;
    const apiShare = fails.length ? apiFails / fails.length : 0;

    // Per-biller hard-down detection (bank side).
    const perBiller = new Map<string, { total: number; fail: number }>();
    for (const e of scored) {
      if (!e.biller) continue;
      const s = perBiller.get(e.biller) ?? { total: 0, fail: 0 };
      s.total += 1;
      if (!e.ok && e.kind === "BILLER_DOWN") s.fail += 1;
      perBiller.set(e.biller, s);
    }
    const downBillers = [...perBiller.entries()]
      .filter(([, s]) => s.fail >= BILLER_MIN_FAILS && s.fail / s.total >= BILLER_DOWN_RATE)
      .map(([code]) => code);

    let status: BbpsHealthStatus = "OK";
    let reason: string | null = null;
    if (failRate >= API_DOWN_RATE && apiShare >= API_DOWN_SHARE) {
      status = "API_DOWN";
      reason =
        "Bill payments are temporarily down — our payment partner (Same Day BBPS) is facing an outage. Please try again shortly. You will not be charged.";
    } else if (failRate >= DEGRADED_RATE) {
      status = "DEGRADED";
      reason =
        "Some banks are responding slowly on BBPS right now. A few bill payments may fail — any amount debited is auto-refunded to your wallet.";
    }

    return {
      status,
      reason,
      downBillers,
      windowMin: Math.round(WINDOW_MS / 60_000),
      sample,
      failRate: Math.round(failRate * 100) / 100,
    };
  } catch {
    return empty;
  }
}
