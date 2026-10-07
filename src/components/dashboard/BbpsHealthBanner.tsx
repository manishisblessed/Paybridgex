"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CloudOff } from "lucide-react";

/**
 * Live BBPS rail-health banner + polling hook, shared by the credit-card and
 * generic bill-pay forms. Shows an honest, calm status when the Same Day /
 * BBPS rail is degraded or down, so retailers understand the issue is upstream
 * (not their card, and their money is safe) instead of seeing a mysterious red
 * error. Backed by GET /api/services/bbps/health.
 */

export type BbpsHealth = {
  status: "OK" | "DEGRADED" | "API_DOWN";
  reason: string | null;
  downBillers: string[];
};

const OK: BbpsHealth = { status: "OK", reason: null, downBillers: [] };

export function useBbpsHealth(pollMs = 45_000): {
  health: BbpsHealth;
  refresh: () => void;
} {
  const [health, setHealth] = useState<BbpsHealth>(OK);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/services/bbps/health", { cache: "no-store" });
      if (!res.ok) return;
      const d = await res.json();
      setHealth({
        status: d.status === "API_DOWN" || d.status === "DEGRADED" ? d.status : "OK",
        reason: typeof d.reason === "string" ? d.reason : null,
        downBillers: Array.isArray(d.downBillers) ? d.downBillers.filter((x: unknown) => typeof x === "string") : [],
      });
    } catch {
      /* health is best-effort — never surface a polling error */
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, pollMs);
    return () => clearInterval(id);
  }, [refresh, pollMs]);

  return { health, refresh };
}

export function BbpsHealthBanner({ health }: { health: BbpsHealth }) {
  if (health.status === "OK") return null;
  const apiDown = health.status === "API_DOWN";

  return (
    <div
      role="status"
      className={`sm:col-span-2 flex items-start gap-3 rounded-2xl border p-4 text-sm ${
        apiDown
          ? "border-rose-200 bg-rose-50 text-rose-800"
          : "border-amber-200 bg-amber-50 text-amber-800"
      }`}
    >
      {apiDown ? (
        <CloudOff className="mt-0.5 h-5 w-5 shrink-0" />
      ) : (
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
      )}
      <div>
        <p className="font-semibold">
          {apiDown
            ? "Bill payments are temporarily down"
            : "Bank network is running slow right now"}
        </p>
        <p className="mt-0.5 leading-relaxed">
          {health.reason ??
            (apiDown
              ? "Our payment partner is facing an outage. Please try again shortly — you will not be charged."
              : "Some banks are responding slowly on BBPS. A few payments may fail — any amount debited is auto-refunded to your wallet.")}
        </p>
      </div>
    </div>
  );
}
