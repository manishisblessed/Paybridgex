"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  Users,
  IndianRupee,
  CircleDollarSign,
  Landmark,
  RefreshCw,
  CheckCircle2,
  Hourglass,
  XCircle,
  ArrowRight,
  Layers,
} from "lucide-react";
import { StatCard } from "@/components/dashboard/StatCard";
import { StatSkeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
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

type MemberRow = {
  id: string;
  userCode: string | null;
  name: string;
  shop: string;
  role: string;
  city: string;
  state: string;
  status: string;
  walletBalance: number;
  txnCount: number;
  successCount: number;
  pendingCount: number;
  failedCount: number;
  volume: number;
  commission: number;
};

type NetworkOverview = {
  level: string;
  childLabel: string;
  range: { from: string; to: string };
  summary: {
    totalTransactions: number;
    successCount: number;
    pendingCount: number;
    failedCount: number;
    totalVolume: number;
    totalCommission: number;
    totalMembers: number;
    activeMembers: number;
    payout: ServiceToday;
  };
  serviceBreakdown: ServiceRow[];
  members: MemberRow[];
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

export function NetworkOverview() {
  const today = useMemo(istToday, []);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [data, setData] = useState<NetworkOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard/network-overview?from=${from}&to=${to}`);
      if (!res.ok) {
        if (res.status === 403) {
          setData(null);
          setError("forbidden");
          return;
        }
        throw new Error(`Request failed (${res.status})`);
      }
      setData((await res.json()) as NetworkOverview);
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

  const childLabel = data?.childLabel ?? "network";
  const isToday = from === today && to === today;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink-900">
            Network Business Overview
          </h2>
          <p className="text-sm text-ink-500">
            {isToday ? "Today's" : "Selected period's"} transaction activity across your{" "}
            <span className="font-semibold text-ink-600">{childLabel}</span> — each row rolls
            up that member&apos;s entire downline. Volume is{" "}
            <span className="font-semibold text-ink-600">completed</span> business.
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
          Couldn&apos;t load the network overview.{" "}
          <button onClick={load} className="font-semibold underline">
            Try again
          </button>
        </div>
      ) : data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard
              label="Total Transactions"
              value={formatNumber(data.summary.totalTransactions)}
              icon={Activity}
              accent="brand"
            />
            <StatCard
              label="Transacting Members"
              value={`${formatNumber(data.summary.activeMembers)} / ${formatNumber(
                data.summary.totalMembers
              )}`}
              icon={Users}
              accent="violet"
            />
            <StatCard
              label="Total Volume"
              value={formatINR(data.summary.totalVolume)}
              icon={IndianRupee}
              accent="emerald"
            />
            <StatCard
              label="Commission (network)"
              value={formatINR(data.summary.totalCommission)}
              icon={CircleDollarSign}
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

          <div className="grid gap-4 lg:grid-cols-3">
            {/* Service-wise breakdown */}
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
                <ul className="space-y-2">
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

            {/* Member-wise table */}
            <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white lg:col-span-2">
              <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
                <div>
                  <h3 className="font-display text-base font-semibold capitalize text-ink-900">
                    Member-wise activity
                  </h3>
                  <p className="text-xs text-ink-500">
                    Direct {childLabel} · click a row for full transaction details
                  </p>
                </div>
                <Link
                  href="/dashboard/network"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
                >
                  View network <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
              {data.members.length === 0 ? (
                <div className="px-5 py-12 text-center text-sm text-ink-500">
                  No {childLabel} yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-ink-50/60 text-left text-xs uppercase tracking-wider text-ink-500">
                      <tr>
                        <th className="px-5 py-3 font-semibold">Member</th>
                        <th className="px-5 py-3 font-semibold">Status</th>
                        <th className="px-5 py-3 font-semibold text-right">Txns</th>
                        <th className="px-5 py-3 font-semibold text-right">Volume</th>
                        <th className="px-5 py-3 font-semibold text-right">Commission</th>
                        <th className="px-5 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-100 text-ink-800">
                      {data.members.map((m) => (
                        <tr key={m.id} className="group hover:bg-ink-50/40">
                          <td className="px-5 py-3">
                            <Link href={`/dashboard/network/${m.id}`} className="block">
                              <div className="font-semibold text-ink-900 group-hover:text-brand-700">
                                {m.name}
                              </div>
                              <div className="text-xs text-ink-500">
                                {m.userCode ?? m.id.slice(0, 10)} · {m.city}
                              </div>
                            </Link>
                          </td>
                          <td className="px-5 py-3">
                            <Badge
                              variant={
                                m.status === "Active"
                                  ? "success"
                                  : m.status === "Pending KYC"
                                    ? "warning"
                                    : "danger"
                              }
                            >
                              {m.status}
                            </Badge>
                          </td>
                          <td className="px-5 py-3 text-right">
                            <div className="font-semibold">{formatNumber(m.txnCount)}</div>
                            <div className="text-[11px] text-ink-500">
                              {formatNumber(m.successCount)} ok
                              {m.pendingCount > 0 ? ` · ${formatNumber(m.pendingCount)} pend` : ""}
                              {m.failedCount > 0 ? ` · ${formatNumber(m.failedCount)} fail` : ""}
                            </div>
                          </td>
                          <td className="px-5 py-3 text-right font-semibold text-emerald-700">
                            {formatINR(m.volume)}
                          </td>
                          <td className="px-5 py-3 text-right text-ink-700">
                            {formatINR(m.commission)}
                          </td>
                          <td className="px-5 py-3 text-right">
                            <Link
                              href={`/dashboard/network/${m.id}`}
                              className="inline-flex items-center text-ink-300 group-hover:text-brand-600"
                              aria-label={`Open ${m.name}`}
                            >
                              <ArrowRight className="h-4 w-4" />
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
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
