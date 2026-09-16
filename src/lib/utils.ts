import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatINR(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

export function generateRefId(prefix = "TXN") {
  const date = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}${date}${rand}`;
}

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── IST display formatting ──────────────────────────────────────────────────
// The platform's operating timezone is Asia/Kolkata (fixed +05:30, no DST).
// `Intl`/`toLocaleString` only pins the *locale* — WITHOUT an explicit `timeZone`
// it falls back to the runtime's zone. On the server (API routes / RSC on a UTC
// host) that silently renders times ~5.5h behind IST (e.g. a 12:30 PM IST txn
// shows as "07:00 AM"). These helpers pin `Asia/Kolkata` so server- and
// client-rendered timestamps ALWAYS agree, regardless of host/browser zone.
export const IST_TIME_ZONE = "Asia/Kolkata";

/**
 * Format a date/instant for DISPLAY in India Standard Time.
 * Accepts `Date | ISO string | epoch ms | null | undefined`; invalid/empty
 * input renders `fallback` (default "—"). Extra `options` are merged on top of
 * the pinned `timeZone`, so callers keep full control of the format.
 */
export function formatIST(
  value: Date | string | number | null | undefined,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" },
  fallback = "—"
): string {
  if (value === null || value === undefined || value === "") return fallback;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toLocaleString("en-IN", { timeZone: IST_TIME_ZONE, ...options });
}

/** IST date only, e.g. "14 Sep 2026". */
export function formatISTDate(
  value: Date | string | number | null | undefined,
  fallback = "—"
): string {
  return formatIST(value, { day: "2-digit", month: "short", year: "numeric" }, fallback);
}

/** IST date + time, e.g. "14 Sep 2026, 12:30 pm". */
export function formatISTDateTime(
  value: Date | string | number | null | undefined,
  fallback = "—"
): string {
  return formatIST(
    value,
    { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" },
    fallback
  );
}

/** IST time only, e.g. "12:30 pm". */
export function formatISTTime(
  value: Date | string | number | null | undefined,
  fallback = "—"
): string {
  return formatIST(value, { hour: "2-digit", minute: "2-digit" }, fallback);
}

// ── IST business-day helpers ────────────────────────────────────────────────
// The platform's operating timezone is Asia/Kolkata (fixed +05:30, no DST), and
// the live payin monitor resets at IST midnight (see `istPeriodStart` in
// src/lib/wallet/payin.ts). These helpers give every date-windowed feed the SAME
// IST day boundary so, e.g., POS Fleet "Captured Volume" reconciles exactly with
// the top-bar "Payin · Today" chip instead of drifting by the 5.5h UTC offset.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Today's date as `YYYY-MM-DD` in IST (the business day, not the UTC day). */
export function istToday(): string {
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The IST date `days` days before today, as `YYYY-MM-DD`. */
export function istDaysAgo(days: number): string {
  return new Date(Date.now() + IST_OFFSET_MS - days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Convert an inclusive IST calendar-day range (`YYYY-MM-DD` strings) into the
 * UTC instants that bound it, returned as `Z` ISO strings. IST midnight →
 * `${from}T00:00:00.000+05:30`; IST end-of-day → `${to}T23:59:59.999+05:30`.
 * Emitting the UTC (`Z`) form keeps it safe to drop into query strings (no `+`
 * to url-encode) and into JSON bodies alike.
 */
export function istDayRangeUtc(fromDate: string, toDate: string): { from: string; to: string } {
  return {
    from: new Date(`${fromDate}T00:00:00.000+05:30`).toISOString(),
    to: new Date(`${toDate}T23:59:59.999+05:30`).toISOString(),
  };
}

/** Role-based user code prefixes (production format). */
export const USER_CODE_PREFIX: Record<string, string> = {
  RETAILER: "RT",
  DISTRIBUTOR: "DT",
  MASTER_DISTRIBUTOR: "MD",
  SUPER_DISTRIBUTOR: "SD",
};

/**
 * Build a user code from a role prefix and a sequence number.
 * Sequence starts at 101, zero-padded to 4 digits.
 * e.g. role=RETAILER, seq=1 → "RT0101", seq=2 → "RT0102"
 */
export function buildUserCode(role: string, seq: number): string {
  const prefix = USER_CODE_PREFIX[role] ?? "XX";
  const num = (100 + seq).toString().padStart(4, "0");
  return `${prefix}${num}`;
}

/**
 * Fuzzy name comparison for cross-document verification (Aadhaar vs PAN vs Bank).
 * Normalises casing, strips honorifics, and tolerates word reordering / minor diffs.
 */
export function namesMatch(a: string, b: string): boolean {
  if (!a || !b) return false;

  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z\s]/g, "")
      .replace(
        /\b(mr|mrs|ms|shri|smt|dr|prof|kumari|sri|late)\b/g,
        ""
      )
      .trim()
      .replace(/\s+/g, " ");

  const na = normalize(a);
  const nb = normalize(b);

  if (na === nb) return true;

  const wordsA = na.split(" ").filter(Boolean).sort();
  const wordsB = nb.split(" ").filter(Boolean).sort();

  if (wordsA.join(" ") === wordsB.join(" ")) return true;

  const setA = new Set(wordsA);
  const setB = new Set(wordsB);
  const intersection = wordsA.filter((w) => setB.has(w));
  const union = new Set([...setA, ...setB]);
  const similarity = intersection.length / union.size;
  return similarity >= 0.6;
}

/** Levenshtein edit distance between two strings (used for near-token matching). */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

export type NameMatchLevel = "match" | "similar" | "mismatch";

/**
 * Classify how closely two names align, returning one of three levels:
 *  - "match":    effectively the same name (exact, reordered, or high overlap).
 *                Uses the same rule as `namesMatch`, so existing behaviour is
 *                preserved for genuine matches.
 *  - "similar":  not an exact match, but strong partial overlap makes it
 *                plausibly the same person — e.g. a shared surname/given name, a
 *                prefix like "Nitin" vs "Nitinkumar", reordering, or a one-char
 *                typo. These should require a self-declaration + manual review.
 *  - "mismatch": essentially unrelated names — should be hard-blocked.
 */
export function compareNames(a: string, b: string): NameMatchLevel {
  if (!a || !b) return "mismatch";
  if (namesMatch(a, b)) return "match";

  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z\s]/g, "")
      .replace(/\b(mr|mrs|ms|shri|smt|dr|prof|kumari|sri|late)\b/g, "")
      .trim()
      .replace(/\s+/g, " ");

  // Word tokens only — drop single-letter initials (e.g. the "A" in
  // "NITINKUMAR A HOTWANI") so they don't dilute the comparison.
  const wordsA = normalize(a)
    .split(" ")
    .filter((w) => w.length > 1);
  const wordsB = normalize(b)
    .split(" ")
    .filter((w) => w.length > 1);
  if (wordsA.length === 0 || wordsB.length === 0) return "mismatch";

  const tokenAlike = (t1: string, t2: string): boolean => {
    if (t1 === t2) return true;
    // One token is a prefix of the other (e.g. "nitin" vs "nitinkumar").
    const [short, long] = t1.length <= t2.length ? [t1, t2] : [t2, t1];
    if (short.length >= 3 && long.startsWith(short)) return true;
    // Tolerate a single-character typo.
    if (editDistance(t1, t2) <= 1) return true;
    return false;
  };

  // How many tokens of the SHORTER name have a soft match in the longer name.
  const [shortWords, longWords] =
    wordsA.length <= wordsB.length ? [wordsA, wordsB] : [wordsB, wordsA];
  const matched = shortWords.filter((w) =>
    longWords.some((o) => tokenAlike(w, o))
  ).length;
  const ratio = matched / shortWords.length;

  // Require at least half of the shorter name's words to plausibly appear in the
  // other name for it to count as "similar" rather than a hard mismatch.
  return ratio >= 0.5 ? "similar" : "mismatch";
}

/**
 * Build the "tombstoned" identity fields for a soft-deleted user so their real
 * email / phone / userCode / shopName are FREED for reuse while the row itself
 * is retained (audit trail, FK integrity). Mirrors the convention used by the
 * maintenance scripts (deleted.<id>@invalid.paybridgex / +91DEL<id-suffix>).
 *
 * Without this, the hard `@unique` constraints on email/phone keep an old
 * account's identity reserved forever — blocking re-creation with the same
 * email/phone until the row is physically purged.
 */
export function tombstonedIdentity(id: string): {
  email: string;
  phone: string;
  userCode: null;
  shopName: null;
} {
  const suffix = id.replace(/[^a-z0-9]/gi, "").slice(-9);
  return {
    email: `deleted.${id}@invalid.paybridgex`,
    phone: `+91DEL${suffix}`,
    userCode: null,
    shopName: null,
  };
}

/** Generate a strong, human-friendly random password (10 chars, mixed case + digits). */
export function generateRandomPassword(length = 10): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const special = "@#$%&*";
  const all = upper + lower + digits + special;

  const pick = (set: string) =>
    set.charAt(Math.floor(Math.random() * set.length));

  let pwd = pick(upper) + pick(lower) + pick(digits) + pick(special);
  for (let i = pwd.length; i < length; i++) pwd += pick(all);

  return pwd
    .split("")
    .sort(() => Math.random() - 0.5)
    .join("");
}
