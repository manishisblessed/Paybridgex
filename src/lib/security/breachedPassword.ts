import crypto from "crypto";
import { flags } from "../env";
import { securityLogger } from "../logger";

/**
 * Breached-password detection via the Have I Been Pwned "range" API using
 * k-anonymity: we send only the first 5 chars of the SHA-1 of the password and
 * match the returned suffixes locally. The full password (and its full hash)
 * never leaves this process.
 *
 * Fail-open: if HIBP is unreachable we allow the password (logging a warning)
 * rather than blocking legitimate signups on a third-party outage. Disable
 * entirely with SECURITY_HIBP_ENABLED="false".
 */

const HIBP_RANGE_URL = "https://api.pwnedpasswords.com/range/";
const TIMEOUT_MS = 2500;

export class BreachedPasswordError extends Error {
  public statusCode = 400;
  constructor(public count: number) {
    super("This password has appeared in known data breaches. Please choose a different one.");
    this.name = "BreachedPasswordError";
  }
}

export type BreachResult = { breached: boolean; count: number; checked: boolean };

export async function isPasswordBreached(password: string): Promise<BreachResult> {
  if (!flags.hibp) return { breached: false, count: 0, checked: false };

  const sha1 = crypto.createHash("sha1").update(password).digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(`${HIBP_RANGE_URL}${prefix}`, {
      // Add-Padding masks the real result size from a network observer.
      headers: { "Add-Padding": "true", "User-Agent": "Paybridgex-Security" },
      signal: controller.signal,
      cache: "no-store",
    }).finally(() => clearTimeout(timer));

    if (!res.ok) {
      securityLogger.warn({ action: "hibp.unavailable", status: res.status });
      return { breached: false, count: 0, checked: false };
    }

    const body = await res.text();
    for (const line of body.split("\n")) {
      const [hashSuffix, countStr] = line.trim().split(":");
      if (hashSuffix === suffix) {
        const count = Number(countStr) || 0;
        // count 0 lines are padding entries — ignore them.
        if (count > 0) return { breached: true, count, checked: true };
      }
    }
    return { breached: false, count: 0, checked: true };
  } catch (err) {
    securityLogger.warn({ action: "hibp.error", err: String(err) });
    return { breached: false, count: 0, checked: false };
  }
}

/** Throw {@link BreachedPasswordError} when the password is known-breached. */
export async function assertPasswordNotBreached(password: string): Promise<void> {
  const result = await isPasswordBreached(password);
  if (result.breached) throw new BreachedPasswordError(result.count);
}
