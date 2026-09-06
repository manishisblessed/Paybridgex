/**
 * Short-TTL cache for the per-request session revalidation done in the
 * NextAuth `jwt` callback.
 *
 * Every authenticated API call re-validates the token against the DB
 * (tokenVersion / status / role). With a remote database that adds a full
 * network round trip to EVERY request before the route's own queries run.
 * Caching the snapshot for a few seconds removes that cost from bursts of
 * requests (dashboard pages fire many in parallel) while keeping forced
 * sign-outs and privilege changes near-immediate:
 *
 *  - Same-process changes (logout, role change via this server) call
 *    `invalidateSessionValidation()` and take effect instantly.
 *  - Cross-instance changes are bounded by the TTL below.
 */

export type SessionValidationSnapshot = {
  name: string;
  tokenVersion: number;
  twoFactorEnabled: boolean;
  twoFactorExempt: boolean;
  walletBalance: unknown;
  status: string;
  role: string;
  enabledServices: string[];
};

const TTL_MS = 20_000;
const MAX_ENTRIES = 5_000;

const cache = new Map<
  string,
  { snap: SessionValidationSnapshot | null; expiresAt: number }
>();

export function getCachedSessionValidation(
  userId: string
): SessionValidationSnapshot | null | undefined {
  const hit = cache.get(userId);
  if (!hit) return undefined;
  if (hit.expiresAt < Date.now()) {
    cache.delete(userId);
    return undefined;
  }
  return hit.snap;
}

/** `snap = null` caches a negative result (user missing / not allowed). */
export function setCachedSessionValidation(
  userId: string,
  snap: SessionValidationSnapshot | null
): void {
  if (cache.size >= MAX_ENTRIES) {
    // Drop the oldest entries (Map preserves insertion order).
    const excess = cache.size - MAX_ENTRIES + 1;
    let i = 0;
    for (const key of cache.keys()) {
      cache.delete(key);
      if (++i >= excess) break;
    }
  }
  cache.set(userId, { snap, expiresAt: Date.now() + TTL_MS });
}

/** Call whenever tokenVersion/status/role changes so the change is instant. */
export function invalidateSessionValidation(userId: string): void {
  cache.delete(userId);
}
