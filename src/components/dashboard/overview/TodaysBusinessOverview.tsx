"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  IndianRupee,
  QrCode,
  Monitor,
  ReceiptText,
  CreditCard,
  Landmark,
  Banknote,
  Clock,
  CircleDollarSign,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  ArrowUpRight,
} from "lucide-react";
import { StatCard } from "@/components/dashboard/StatCard";
import { StatSkeleton } from "@/components/ui/Skeleton";
import { CountUp } from "@/components/motion";
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

type GrowthState = "new" | "flat" | "up" | "down";

type BusinessOverview = {
  date: string;
  total: ServiceToday;
  qr: ServiceToday;
  pos: ServiceToday;
  bbps: ServiceToday;
  pg: ServiceToday;
  payout: ServiceToday;
  summary: {
    settlementToday: number;
    pendingAmount: number;
    commissionRevenue: number;
    yesterdayTotal: number;
    growthPct: number | null;
    growthState: GrowthState;
  };
};

type Accent = "brand" | "accent" | "emerald" | "violet";

const accents: Record<Accent, string> = {
  brand: "from-brand-500 to-brand-700",
  accent: "from-accent-500 to-accent-600",
  emerald: "from-emerald-500 to-emerald-700",
  violet: "from-violet-500 to-violet-700",
};

const glows: Record<Accent, string> = {
  brand: "bg-brand-500/10",
  accent: "bg-accent-500/10",
  emerald: "bg-emerald-500/10",
  violet: "bg-violet-500/10",
};

/**
 * Every card drills into the unified report system pre-filtered to the SAME IST
 * day (`date`) the panel is summarising, so the detailed view always matches the
 * headline figure. All targets are rendered by ReportView, which reads the
 * `from`/`to` query params.
 */
function cardLinks(date: string) {
  const day = `from=${date}&to=${date}`;
  return {
    total: `/dashboard/reports/summary?${day}`,
    // QR Today is collection/settlement business — deep-link to the QR Settlement
    // Report (per-claim), NOT the QR-codes inventory report.
    qr: `/dashboard/qr?tab=report&${day}`,
    // POS Today is settlement/turnover business — deep-link to the POS Settlement
    // Report (per-transaction, from PosSettlementEntry), NOT the machines inventory.
    pos: `/dashboard/pos?tab=report&${day}`,
    bbps: `/dashboard/reports/bill-payment?${day}`,
    pg: `/dashboard/reports/pg?${day}`,
    payout: `/dashboard/reports/payout?${day}`,
    settlement: `/dashboard/reports/wallet-settlement?${day}`,
    pending: `/dashboard/reports/wallet-settlement?${day}`,
    revenue: `/dashboard/reports/commission?${day}`,
    growth: `/dashboard/reports/summary?${day}`,
  } as const;
}

function prettyDate(iso: string) {
  // `iso` is an IST calendar date (YYYY-MM-DD). Format without timezone drift.
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function TodaysBusinessOverview() {
  const [data, setData] = useState<BusinessOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/business-overview");
      if (!res.ok) {
        // 403 = not permitted for this account; hide the section silently.
        if (res.status === 403) {
          setData(null);
          setError("forbidden");
          return;
        }
        throw new Error(`Request failed (${res.status})`);
      }
      setData((await res.json()) as BusinessOverview);
    } catch {
      setError("load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Permission-denied: render nothing so the rest of the dashboard is untouched.
  if (error === "forbidden") return null;

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-lg font-semibold text-ink-900">
              Today&apos;s Business Overview
            </h2>
            {data && (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-0.5 text-[11px] font-semibold text-brand-700 ring-1 ring-inset ring-brand-100">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-500" />
                {prettyDate(data.date)}
              </span>
            )}
          </div>
          <p className="max-w-2xl text-sm text-ink-500">
            Platform business done today across all major services. Headline amounts
            are <span className="font-semibold text-ink-600">completed</span> business;
            pending &amp; failed are shown separately.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-full border border-ink-100 bg-white px-3 py-1.5 text-xs font-semibold text-ink-600 shadow-sm transition hover:border-brand-200 hover:text-brand-700 hover:shadow-soft disabled:opacity-60"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <StatSkeleton key={i} />
          ))}
        </div>
      ) : error === "load" ? (
        <div className="rounded-2xl border border-dashed border-rose-200 bg-rose-50/50 p-6 text-center text-sm text-rose-700">
          Couldn&apos;t load today&apos;s business overview.{" "}
          <button onClick={load} className="font-semibold underline">
            Try again
          </button>
        </div>
      ) : data ? (
        (() => {
          const links = cardLinks(data.date);
          return (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <TotalBusinessCard data={data.total} href={links.total} />
                <ServiceBusinessCard label="QR Today" icon={QrCode} accent="violet" data={data.qr} href={links.qr} />
                <ServiceBusinessCard label="POS Today" icon={Monitor} accent="emerald" data={data.pos} href={links.pos} />
                <ServiceBusinessCard label="BBPS Today" icon={ReceiptText} accent="accent" data={data.bbps} href={links.bbps} />
                <ServiceBusinessCard label="PG Today" icon={CreditCard} accent="brand" data={data.pg} href={links.pg} />
                <ServiceBusinessCard label="Payout Today" icon={Landmark} accent="accent" data={data.payout} href={links.payout} />
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                  label="Settled Today (net)"
                  value={formatINR(data.summary.settlementToday)}
                  countTo={data.summary.settlementToday}
                  prefix="₹"
                  icon={Banknote}
                  accent="emerald"
                  href={links.settlement}
                />
                <StatCard
                  label="Pending Settlement (today)"
                  value={formatINR(data.summary.pendingAmount)}
                  countTo={data.summary.pendingAmount}
                  prefix="₹"
                  icon={Clock}
                  accent="accent"
                  href={links.pending}
                />
                <StatCard
                  label="Commission / Revenue"
                  value={formatINR(data.summary.commissionRevenue)}
                  countTo={data.summary.commissionRevenue}
                  prefix="₹"
                  icon={CircleDollarSign}
                  accent="violet"
                  href={links.revenue}
                />
                <GrowthCard summary={data.summary} href={links.growth} />
              </div>
            </div>
          );
        })()
      ) : null}
    </section>
  );
}

/**
 * Rupee breakdown for the value that is NOT in the headline (pending/failed), so
 * every amount on the card is traceable — e.g. a POS card reading ₹0 completed
 * still shows the "₹8,50,165 pending" it is waiting to settle.
 */
function AmountBreakdown({ data, onDark = false }: { data: ServiceToday; onDark?: boolean }) {
  const parts: Array<{ key: string; text: string; tone: string }> = [];
  if (data.pendingAmount > 0) {
    parts.push({
      key: "pending",
      text: `${formatINR(data.pendingAmount)} pending`,
      tone: onDark ? "text-white/85" : "text-amber-700",
    });
  }
  if (data.failedAmount > 0) {
    parts.push({
      key: "failed",
      text: `${formatINR(data.failedAmount)} failed`,
      tone: onDark ? "text-white/85" : "text-rose-600",
    });
  }
  if (parts.length === 0) return null;
  return (
    <p className="mt-2 text-[11px] font-medium">
      {parts.map((p, i) => (
        <span key={p.key} className={p.tone}>
          {i > 0 && <span className={onDark ? "text-white/50" : "text-ink-300"}> · </span>}
          {p.text}
        </span>
      ))}
    </p>
  );
}

/**
 * A single stacked bar (success / pending / failed) plus a compact one-line
 * legend. This replaces the three wrapping pills that made narrow cards feel
 * cramped: the bar communicates the mix at a glance and never wraps.
 */
function StatusBar({ data, onDark = false }: { data: ServiceToday; onDark?: boolean }) {
  const total = data.success + data.pending + data.failed;
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);

  const track = onDark ? "bg-white/20" : "bg-ink-100";
  const successBar = onDark ? "bg-white" : "bg-emerald-500";
  const pendingBar = onDark ? "bg-white/70" : "bg-amber-400";
  const failedBar = onDark ? "bg-white/40" : "bg-rose-500";

  const dot = (cls: string) => (
    <span className={cn("h-1.5 w-1.5 rounded-full", cls)} aria-hidden />
  );

  const numCls = onDark ? "text-white" : "text-ink-800";
  const labelCls = onDark ? "text-white/70" : "text-ink-500";

  return (
    <div className="mt-3.5">
      <div className={cn("flex h-1.5 w-full overflow-hidden rounded-full", track)}>
        {total > 0 && (
          <>
            <span className={cn("h-full transition-all", successBar)} style={{ width: `${pct(data.success)}%` }} />
            <span className={cn("h-full transition-all", pendingBar)} style={{ width: `${pct(data.pending)}%` }} />
            <span className={cn("h-full transition-all", failedBar)} style={{ width: `${pct(data.failed)}%` }} />
          </>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-1.5 text-[11px] font-semibold">
        <span className="inline-flex items-center gap-1">
          {dot(onDark ? "bg-white" : "bg-emerald-500")}
          <span className={numCls}>{formatNumber(data.success)}</span>
          <span className={labelCls}>Success</span>
        </span>
        <span className="inline-flex items-center gap-1">
          {dot(onDark ? "bg-white/70" : "bg-amber-400")}
          <span className={numCls}>{formatNumber(data.pending)}</span>
          <span className={labelCls}>Pending</span>
        </span>
        <span className="inline-flex items-center gap-1">
          {dot(onDark ? "bg-white/40" : "bg-rose-500")}
          <span className={numCls}>{formatNumber(data.failed)}</span>
          <span className={labelCls}>Failed</span>
        </span>
      </div>
    </div>
  );
}

function ServiceBusinessCard({
  label,
  icon: Icon,
  accent,
  data,
  href,
}: {
  label: string;
  icon: LucideIcon;
  accent: Accent;
  data: ServiceToday;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group relative block overflow-hidden rounded-2xl border border-ink-100 bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
    >
      <div
        className={cn(
          "pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full blur-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100",
          glows[accent]
        )}
        aria-hidden
      />
      <div className="relative flex items-start justify-between">
        <span
          className={cn(
            "grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br text-white shadow-soft transition-transform duration-200 group-hover:scale-105",
            accents[accent]
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-ink-50 px-2.5 py-1 text-[11px] font-semibold text-ink-600">
          {formatNumber(data.count)} Txn
        </span>
      </div>
      <p className="relative mt-4 text-[11px] font-semibold uppercase tracking-widest text-ink-500">
        {label}
      </p>
      <p className="relative mt-1 font-display text-2xl font-bold text-ink-900">
        <CountUp value={data.amount} prefix="₹" duration={1.1} />
      </p>
      <StatusBar data={data} />
      <AmountBreakdown data={data} />
      <span className="pointer-events-none absolute bottom-4 right-4 text-ink-300 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 -translate-x-1">
        <ArrowUpRight className="h-4 w-4" />
      </span>
    </Link>
  );
}

function TotalBusinessCard({ data, href }: { data: ServiceToday; href: string }) {
  return (
    <Link
      href={href}
      className="group relative block overflow-hidden rounded-2xl bg-gradient-to-br from-brand-700 via-brand-600 to-accent-500 p-5 text-white shadow-glow transition-all duration-200 hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
    >
      <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-white/10 blur-2xl transition-transform duration-500 group-hover:scale-125" />
      <div className="pointer-events-none absolute -bottom-12 -left-8 h-32 w-32 rounded-full bg-accent-400/20 blur-2xl" />
      <div className="relative flex items-start justify-between">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-white/15 shadow-soft ring-1 ring-inset ring-white/20 backdrop-blur-sm transition-transform duration-200 group-hover:scale-105">
          <IndianRupee className="h-5 w-5" />
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ring-white/20">
          {formatNumber(data.count)} Txn
        </span>
      </div>
      <p className="relative mt-4 text-[11px] font-semibold uppercase tracking-widest text-white/80">
        Total Business Today
      </p>
      <p className="relative mt-1 font-display text-2xl font-bold">
        <CountUp value={data.amount} prefix="₹" duration={1.1} />
      </p>
      <StatusBar data={data} onDark />
      <AmountBreakdown data={data} onDark />
    </Link>
  );
}

/**
 * Format a period-over-period change for display. Growth can be unbounded on the
 * upside (yesterday ≈ 0), so cap the readout at ±999% to avoid absurd figures
 * like "+850065%". Losses are naturally floored at -100%.
 */
function formatGrowth(pct: number | null, state: GrowthState): string {
  if (state === "new") return "New";
  if (pct === null) return "0%";
  const rounded = Math.round(pct * 10) / 10;
  if (rounded >= 1000) return "+999%+";
  if (rounded <= -1000) return "-999%+";
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}%`;
}

function GrowthCard({
  summary,
  href,
}: {
  summary: BusinessOverview["summary"];
  href: string;
}) {
  const { growthPct, growthState } = summary;

  const display = formatGrowth(growthPct, growthState);

  const positive = growthState === "up" || growthState === "new";
  const Icon = growthState === "down" ? TrendingDown : TrendingUp;
  const accent: Accent = growthState === "down" ? "accent" : "emerald";

  return (
    <Link
      href={href}
      className="group relative block overflow-hidden rounded-2xl border border-ink-100 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
    >
      <div
        className={cn(
          "pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full blur-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100",
          glows[accent]
        )}
        aria-hidden
      />
      <div className="relative flex items-start justify-between">
        <span
          className={cn(
            "grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br text-white shadow-soft",
            accents[accent]
          )}
        >
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold",
            positive ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
          )}
        >
          vs yesterday
        </span>
      </div>
      <p className="relative mt-3 text-[11px] font-semibold uppercase tracking-widest text-ink-500">
        Yesterday vs Today Growth
      </p>
      <p
        className={cn(
          "relative mt-0.5 font-display text-xl font-bold",
          positive ? "text-emerald-600" : "text-rose-600"
        )}
      >
        {display}
      </p>
      <p className="relative mt-1 text-[11px] text-ink-500">
        Yesterday: {formatINR(summary.yesterdayTotal)}
      </p>
    </Link>
  );
}
