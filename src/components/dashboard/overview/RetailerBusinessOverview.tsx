"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  IndianRupee,
  Activity,
  CircleDollarSign,
  Landmark,
  Clock,
  RefreshCw,
  CheckCircle2,
  Hourglass,
  XCircle,
  Layers,
} from "lucide-react";
import { StatCard } from "@/components/dashboard/StatCard";
import { StatSkeleton } from "@/components/ui/Skeleton";
import { formatINR, formatNumber, cn } from "@/lib/utils";

type ServiceToday = {
  amount: number;
  pendingAmount: number;
  failedAmount: number;
  count: number;
  success: number;
  pending: number;
  failed: number;
};

type ServiceRow = { service: string; label: string } & ServiceToday;

type MyBusiness = {
  range: { from: string; to: string };
  total: ServiceToday;
  serviceBreakdown: ServiceRow[];
  summary: {
    successCount: number;
    pendingCount: number;
    failedCount: number;
    totalVolume: number;
    totalCommission: number;
    payout: ServiceToday;
    pendingSettlement: number;
  };
};

/**
 * IST "today" as YYYY-MM-DD. IST is a fixed UTC+05:30 offset (no DST), so adding
 * the offset to the epoch and reading the UTC date parts yields the IST wall date
 * regardless of the browser's own timezone.
 */
function istToday(): string {
  const istMs = Date.now() + (5 * 60 + 30) * 60 * 1000;
  return new Date(istMs).toISOString().slice(0, 10);
}

export function RetailerBusinessOverview() {
  const today = useMemo(istToday, []);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [data, setData] = useState<MyBusiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard/my-business-overview?from=${from}&to=${to}`);
      if (!res.ok) {
        if (res.status === 403) {
          setData(null);
          setError("forbidden");
          return;
        }
        throw new Error(`Request failed (${res.status})`);
      }
      setData((await res.json()) as MyBusiness);
    } catch {
      setError("load");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  if (error === "forbidden") return null;

  const isToday = from === today && to === today;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink-900">
            {isToday ? "Today's Business" : "Business Summary"}
          </h2>
          <p className="text-sm text-ink-500">
            Your transaction activity across all services. Volume is{" "}
            <span className="font-semibold text-ink-600">completed</span> business; pending &amp;
            failed are counted separately.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-full border border-ink-100 bg-white px-3 py-1.5">
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="bg-transparent text-xs font-semibold text-ink-700 outline-none"
              aria-label="From date"
            />
            <span className="text-ink-300">→</span>
            <input
              type="date"
              value={to}
              min={from}
              max={today}
              onChange={(e) => setTo(e.target.value)}
              className="bg-transparent text-xs font-semibold text-ink-700 outline-none"
              aria-label="To date"
            />
          </div>
          {!isToday && (
            <button
              type="button"
              onClick={() => {
                setFrom(today);
                setTo(today);
              }}
              className="rounded-full border border-ink-100 bg-white px-3 py-1.5 text-xs font-semibold text-ink-600 transition hover:border-brand-200 hover:text-brand-700"
            >
              Today
            </button>
          )}
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-full border border-ink-100 bg-white px-3 py-1.5 text-xs font-semibold text-ink-600 transition hover:border-brand-200 hover:text-brand-700 disabled:opacity-60"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <StatSkeleton key={i} />
          ))}
        </div>
      ) : error === "load" ? (
        <div className="rounded-2xl border border-dashed border-rose-200 bg-rose-50/50 p-6 text-center text-sm text-rose-700">
          Couldn&apos;t load your business summary.{" "}
          <button onClick={load} className="font-semibold underline">
            Try again
          </button>
        </div>
      ) : data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard
              label="Total Business"
              value={formatINR(data.summary.totalVolume)}
              icon={IndianRupee}
              accent="brand"
            />
            <StatCard
              label="Transactions"
              value={formatNumber(data.total.count)}
              icon={Activity}
              accent="violet"
            />
            <StatCard
              label="Commission Earned"
              value={formatINR(data.summary.totalCommission)}
              icon={CircleDollarSign}
              accent="emerald"
            />
            <StatCard
              label="Pending Settlement"
              value={formatINR(data.summary.pendingSettlement)}
              icon={Clock}
              accent="accent"
            />
            <StatCard
              label="Payouts (outflow)"
              value={formatINR(data.summary.payout.amount)}
              icon={Landmark}
              accent="accent"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <StatusPill icon={CheckCircle2} tone="emerald" n={data.summary.successCount} label="Success" />
            <StatusPill icon={Hourglass} tone="amber" n={data.summary.pendingCount} label="Pending" />
            <StatusPill icon={XCircle} tone="rose" n={data.summary.failedCount} label="Failed" />
          </div>

          <div className="rounded-2xl border border-ink-100 bg-white p-5">
            <div className="mb-3 flex items-center gap-2">
              <Layers className="h-4 w-4 text-brand-600" />
              <h3 className="font-display text-base font-semibold text-ink-900">
                Service-wise breakdown
              </h3>
            </div>
            {data.serviceBreakdown.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-500">
                No transactions in this period.
              </p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {data.serviceBreakdown.map((s) => (
                  <li
                    key={s.service}
                    className="flex items-center justify-between gap-3 rounded-xl bg-ink-50/50 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink-800">{s.label}</p>
                      <p className="text-[11px] text-ink-500">
                        {formatNumber(s.count)} txn · {formatNumber(s.success)} ok
                        {s.pending > 0 ? ` · ${formatNumber(s.pending)} pending` : ""}
                        {s.failed > 0 ? ` · ${formatNumber(s.failed)} failed` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 font-display text-sm font-bold text-ink-900">
                      {formatINR(s.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}

function StatusPill({
  icon: Icon,
  tone,
  n,
  label,
}: {
  icon: typeof CheckCircle2;
  tone: "emerald" | "amber" | "rose";
  n: number;
  label: string;
}) {
  const tones: Record<string, string> = {
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    rose: "bg-rose-50 text-rose-700",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold",
        tones[tone]
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {formatNumber(n)} {label}
    </span>
  );
}
