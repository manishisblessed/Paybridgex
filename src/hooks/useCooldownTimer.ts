"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type UseCooldownTimerProps = {
  billerId: string;
  cardLast4: string;
  partner?: string;
  enabled?: boolean;
};

type CooldownState = {
  blocked: boolean;
  remainingSec: number;
  display: string;
  checking: boolean;
  applyServerCooldown: (retryAfterSec: number, cooldownExpiry?: string) => void;
  recheck: () => void;
};

function formatMmSs(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function storageKey(billerId: string, cardLast4: string): string {
  return `cc-cooldown:${billerId}:${cardLast4}`;
}

function readStoredExpiry(key: string): number | null {
  try {
    const v = sessionStorage.getItem(key);
    if (!v) return null;
    const ts = Number(v);
    return ts > Date.now() ? ts : null;
  } catch {
    return null;
  }
}

function writeStoredExpiry(key: string, expiryMs: number) {
  try {
    sessionStorage.setItem(key, String(expiryMs));
  } catch { /* storage unavailable */ }
}

function clearStored(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch { /* storage unavailable */ }
}

export function useCooldownTimer({
  billerId,
  cardLast4,
  partner,
  enabled = true,
}: UseCooldownTimerProps): CooldownState {
  const [expiryMs, setExpiryMs] = useState<number | null>(null);
  const [remainingSec, setRemainingSec] = useState(0);
  const [checking, setChecking] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clockOffsetRef = useRef(0);

  const sKey = billerId && cardLast4.length === 4 ? storageKey(billerId, cardLast4) : "";

  const startCountdown = useCallback((expiry: number) => {
    setExpiryMs(expiry);
    const remaining = Math.max(0, Math.ceil((expiry - Date.now()) / 1000));
    setRemainingSec(remaining);
    if (sKey) writeStoredExpiry(sKey, expiry);
  }, [sKey]);

  const fetchCooldown = useCallback(async () => {
    if (!billerId || cardLast4.length !== 4 || !enabled) return;
    setChecking(true);
    try {
      const res = await fetch("/api/services/bbps/credit-card/check-cooldown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billerId, cardLast4, ...(partner ? { partner } : {}) }),
      });
      if (!res.ok) return;
      const data = await res.json();

      if (data.serverTime) {
        clockOffsetRef.current = new Date(data.serverTime).getTime() - Date.now();
      }

      if (!data.allowed && data.cooldownExpiry) {
        const expiry = new Date(data.cooldownExpiry).getTime();
        startCountdown(expiry);
      } else {
        setExpiryMs(null);
        setRemainingSec(0);
        if (sKey) clearStored(sKey);
      }
    } catch { /* network error — keep existing state */ }
    finally { setChecking(false); }
  }, [billerId, cardLast4, partner, enabled, sKey, startCountdown]);

  // On mount or input change: check sessionStorage first, then API
  useEffect(() => {
    if (!enabled || !billerId || cardLast4.length !== 4) {
      setExpiryMs(null);
      setRemainingSec(0);
      return;
    }

    const stored = sKey ? readStoredExpiry(sKey) : null;
    if (stored) {
      startCountdown(stored);
    } else {
      fetchCooldown();
    }
  }, [billerId, cardLast4, enabled, sKey, startCountdown, fetchCooldown]);

  // Tick the countdown every second
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    if (!expiryMs || expiryMs <= Date.now()) {
      setRemainingSec(0);
      return;
    }

    intervalRef.current = setInterval(() => {
      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((expiryMs - now) / 1000));
      setRemainingSec(remaining);

      if (remaining <= 0) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = null;
        setExpiryMs(null);
        if (sKey) clearStored(sKey);
        // Re-verify with backend that cooldown has truly expired
        fetchCooldown();
      }
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [expiryMs, sKey, fetchCooldown]);

  const applyServerCooldown = useCallback(
    (retryAfterSec: number, cooldownExpiry?: string) => {
      const expiry = cooldownExpiry
        ? new Date(cooldownExpiry).getTime()
        : Date.now() + retryAfterSec * 1000;
      startCountdown(expiry);
    },
    [startCountdown],
  );

  return {
    blocked: remainingSec > 0,
    remainingSec,
    display: formatMmSs(remainingSec),
    checking,
    applyServerCooldown,
    recheck: fetchCooldown,
  };
}
