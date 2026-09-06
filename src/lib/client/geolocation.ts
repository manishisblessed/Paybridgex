"use client";

/**
 * Best-effort browser geolocation for admin activity recording. Resolves with
 * coordinates when the user has granted permission, or null otherwise (denied,
 * unsupported, or timed out). Never rejects — callers treat a null result as
 * "no live location" and let the server fall back to the last-login location.
 *
 * A short-lived module cache avoids re-prompting the browser on every write.
 */

export type BrowserLocation = { lat: number; lng: number; accuracy: number | null };

let cached: { at: number; value: BrowserLocation } | null = null;
const CACHE_MS = 60_000; // reuse a fix for a minute to avoid repeated prompts

export function getBrowserLocation(timeoutMs = 8000): Promise<BrowserLocation | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return Promise.resolve(cached.value);
  }

  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    let settled = false;
    const done = (value: BrowserLocation | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    // Hard timeout guard in case the browser never calls either callback.
    const timer = setTimeout(() => done(null), timeoutMs + 500);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        const value: BrowserLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
        };
        cached = { at: Date.now(), value };
        done(value);
      },
      () => {
        clearTimeout(timer);
        done(null);
      },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: CACHE_MS }
    );
  });
}
