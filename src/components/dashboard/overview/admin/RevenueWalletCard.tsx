"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Landmark, ArrowDownRight, ArrowUpRight, ArrowRight, RefreshCw } from "lucide-react";
import { formatINR } from "@/lib/utils";

/**
 * Master-admin Revenue Wallet card for the overview: TODAY's MDR margin in,
 * commission paid out, and the current Revenue Wallet balance — so the platform
 * owner never has to go hunting for company earnings. Owner-only: the backing
 * endpoint (view=revenue) 403s for non-master roles, so the card renders nothing
 * for anyone else.
 */

type RevenueSummary = {
  accountId: string | null;
  balance: number;
  marginInToday: number;
  commissionOutToday: number;
  netToday: number;
};

export function RevenueWalletCard() {
  const [data, setData] = useState<RevenueSummary | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/wallet/aggregates?view=revenue");
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (res.ok) setData(await res.json());
    } catch {
      /* keep last data */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Not the platform owner → nothing to show.
  if (forbidden) return null;

  return (
    <div className="rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50/80 to-fuchsia-50/60 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-100 text-violet-700">
            <Landmark className="h-4.5 w-4.5" />
          </span>
          <div>
            <h3 className="font-display text-sm font-bold text-ink-900">Revenue Wallet</h3>
            <p className="text-[11px] text-ink-500">Company earnings · today (IST)</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={load}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-violet-200 text-violet-700 hover:bg-violet-100"
            aria-label="Refresh revenue wallet"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          <Link
            href="/dashboard/admin/revenue"
            className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-white/70 px-2.5 py-1.5 text-[11px] font-semibold text-violet-700 hover:bg-white"
          >
            Company Earnings <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-emerald-100 bg-white/70 p-3">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-emerald-700/80">
            <ArrowDownRight className="h-3.5 w-3.5" /> Margin In · Today
          </div>
          <p className="mt-1 font-display text-lg font-bold text-emerald-700">
            {data ? formatINR(data.marginInToday) : "…"}
          </p>
        </div>
        <div className="rounded-xl border border-rose-100 bg-white/70 p-3">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-rose-700/80">
            <ArrowUpRight className="h-3.5 w-3.5" /> Commission Out · Today
          </div>
          <p className="mt-1 font-display text-lg font-bold text-rose-600">
            {data ? `−${formatINR(data.commissionOutToday)}` : "…"}
          </p>
        </div>
        <div className="rounded-xl border border-violet-200 bg-white/80 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-violet-700/80">
            Wallet Balance
          </div>
          <p className="mt-1 font-display text-lg font-bold text-ink-900">
            {data ? formatINR(data.balance) : "…"}
          </p>
        </div>
      </div>

      <p className="mt-3 text-[11px] text-ink-500">
        Net booked today (margin − commission):{" "}
        <span className={`font-semibold ${(data?.netToday ?? 0) >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
          {data ? formatINR(data.netToday) : "…"}
        </span>{" "}
        · credited to the Revenue Wallet at settlement time.
      </p>
    </div>
  );
}
