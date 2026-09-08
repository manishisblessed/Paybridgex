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
