"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Users, Search, ArrowRight, RefreshCw } from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";
import { formatINRFull } from "./CumulativeWalletCard";

/**
 * User-wise Balances — top wallet-holders across every network tier.
 *
 * Filter pills mirror the tiers exposed by /api/admin/wallet/aggregates.
 * Search debounces to keep the DB happy. Results are capped to a compact
 * top-N so the panel stays scannable on the dashboard; a "View all" link
 * jumps into the full Wallet Ops explorer for deep dives.
 */

type UserRow = {
  id: string;
  name: string;
  email: string;
  shopName: string | null;
  role: string;
  status: string;
  primary: number;
  aeps: number;
  held: number;
  total: number;
};

type ApiResp = {
  rows: UserRow[];
  total: number;
  page: number;
  pageSize: number;
  sums: { primary: number; aeps: number; total: number };
};

type TierKey = "RETAILER" | "DISTRIBUTOR" | "MASTER_DISTRIBUTOR" | "SUPER_DISTRIBUTOR";

const TABS: { key: TierKey; label: string }[] = [
  { key: "RETAILER", label: "Retailers" },
  { key: "DISTRIBUTOR", label: "Distributors" },
  { key: "MASTER_DISTRIBUTOR", label: "Master Distributors" },
  { key: "SUPER_DISTRIBUTOR", label: "Super-Distributors" },
];

const PAGE_SIZE = 10;

export function UserBalancesCard() {
  const [tab, setTab] = useState<TierKey>("RETAILER");
  const [q, setQ] = useState("");
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [asOf, setAsOf] = useState<Date | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        view: "users",
        role: tab,
        q,
        page: "1",
        pageSize: String(PAGE_SIZE),
      });
      const res = await fetch(`/api/admin/wallet/aggregates?${params}`);
      if (res.ok) {
        setData(await res.json());
        setAsOf(new Date());
      }
    } finally {
      setLoading(false);
    }
  }, [tab, q]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(load, q ? 300 : 0);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [load, refreshTick]);

  const totalCount = data?.total ?? 0;
  const shown = data?.rows.length ?? 0;
  const filteredSum = data?.sums.total ?? 0;

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-3xl border border-white/10 p-5 text-white shadow-[0_25px_80px_-25px_rgba(9,13,37,0.55)]",
        "bg-[radial-gradient(120%_120%_at_100%_0%,#141e46_0%,#0b1030_45%,#070a1c_100%)]"
      )}
    >
      <div className="pointer-events-none absolute -top-24 right-0 h-56 w-72 rounded-full bg-brand-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 -left-16 h-48 w-64 rounded-full bg-teal-400/10 blur-3xl" />

      <header className="relative flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-sky-400 to-blue-600 text-white shadow-lg shadow-blue-900/30">
            <Users className="h-5 w-5" strokeWidth={2.2} />
          </span>
          <div>
            <h2 className="font-display text-lg font-bold tracking-tight">
              User-wise Balances
            </h2>
            <p className="text-xs text-slate-400">
              {loading ? (
                <span className="inline-block h-3 w-24 animate-pulse rounded bg-white/10 align-middle" />
              ) : (
                <>
                  {formatNumber(shown)} of {formatNumber(totalCount)} · top
                  wallets by primary balance
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <TabPills value={tab} onChange={setTab} />
          <SearchInput value={q} onChange={setQ} />
          <button
            type="button"
            onClick={() => setRefreshTick((n) => n + 1)}
            className="grid h-8 w-8 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-300 transition hover:bg-white/[0.08] hover:text-white"
            aria-label="Refresh"
            title="Refresh"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
        </div>
      </header>

      {/* table */}
      <div className="relative mt-4 overflow-hidden rounded-2xl border border-white/[0.06] bg-black/25">
        <div className="max-h-[360px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-[#0b1030]/95 backdrop-blur">
              <tr className="text-left text-[11px] font-bold uppercase tracking-widest text-slate-400">
                <th className="w-10 px-4 py-3">#</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3 text-right">Primary</th>
                <th className="px-4 py-3 text-right">AEPS</th>
                <th className="px-4 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {loading &&
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={`s-${i}`} className="animate-pulse">
                    {Array.from({ length: 5 }).map((__, j) => (
                      <td key={j} className="px-4 py-3.5">
                        <div className="h-3 rounded bg-white/10" />
                      </td>
                    ))}
                  </tr>
                ))}
              {!loading && data && data.rows.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-10 text-center text-xs text-slate-500"
                  >
                    No users match this filter.
                  </td>
                </tr>
              )}
              {!loading &&
                data?.rows.map((r, i) => (
                  <tr
                    key={r.id}
                    className="transition hover:bg-white/[0.03]"
                  >
                    <td className="px-4 py-3 text-xs text-slate-500 tabular-nums">
                      {i + 1}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold uppercase leading-tight tracking-wide text-white">
                        {r.name || r.email}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] font-mono uppercase tracking-wider text-rose-300/70">
                        {r.shopName || shortId(r.id)}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-white">
                      {formatINRFull(r.primary)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-white">
                      {formatINRFull(r.aeps)}
                    </td>
                    <td className="px-4 py-3 text-right font-bold tabular-nums text-white">
                      {formatINRFull(r.total)}
                    </td>
                  </tr>
                ))}
            </tbody>
            {!loading && data && data.rows.length > 0 && (
              <tfoot>
                <tr className="border-t border-white/10 bg-white/[0.04] font-display font-bold">
                  <td className="px-4 py-3 text-xs text-slate-400" colSpan={2}>
                    Total ({formatNumber(totalCount)})
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-white">
                    {formatINRFull(data.sums.primary)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-white">
                    {formatINRFull(data.sums.aeps)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-white">
                    {formatINRFull(filteredSum)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <footer className="relative mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
        <Link
          href="/dashboard/admin/wallet-ops"
          className="inline-flex items-center gap-1 font-semibold text-brand-200 transition hover:text-white"
        >
          View all balances <ArrowRight className="h-3 w-3" />
        </Link>
        <span>{asOf ? `As of ${formatTime(asOf)}` : "…"}</span>
      </footer>
    </section>
  );
}

/* ── sub-components ────────────────────────────────────────────────── */

function TabPills({
  value,
  onChange,
}: {
  value: TierKey;
  onChange: (k: TierKey) => void;
}) {
  return (
    <div className="flex items-center rounded-xl border border-white/10 bg-white/[0.04] p-1">
      {TABS.map((t) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-[11px] font-semibold transition",
              active
                ? "bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-md shadow-emerald-900/30"
                : "text-slate-300 hover:text-white"
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function SearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search name / ID…"
        className="h-8 w-56 rounded-xl border border-white/10 bg-white/[0.04] pl-8 pr-3 text-xs text-white placeholder:text-slate-500 outline-none transition focus:border-brand-400/60 focus:bg-white/[0.06]"
      />
    </div>
  );
}

/* ── helpers ───────────────────────────────────────────────────────── */

function shortId(id: string) {
  return id.slice(0, 6).toUpperCase() + id.slice(-4).toUpperCase();
}

function formatTime(d: Date) {
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
