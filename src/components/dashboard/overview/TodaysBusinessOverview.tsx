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
  CheckCircle2,
  Hourglass,
  XCircle,
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
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink-900">
            Today&apos;s Business Overview
          </h2>
          <p className="text-sm text-ink-500">
            Platform business done today across all major services. Headline amounts
            are <span className="font-semibold text-ink-600">completed</span> business;
            pending &amp; failed are shown separately.
          </p>
        </div>
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

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
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
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
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
                  icon={Banknote}
                  accent="emerald"
                  href={links.settlement}
                />
                <StatCard
                  label="Pending Settlement (today)"
                  value={formatINR(data.summary.pendingAmount)}
                  icon={Clock}
                  accent="accent"
                  href={links.pending}
                />
                <StatCard
                  label="Commission / Revenue"
                  value={formatINR(data.summary.commissionRevenue)}
                  icon={CircleDollarSign}
                  accent="violet"
                  href={links.revenue}
                />
                <GrowthCard summary={data.summary} href={links.growth} />
              </div>
            </>
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

function StatusPills({ data }: { data: ServiceToday }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
        <CheckCircle2 className="h-3 w-3" />
        {formatNumber(data.success)} Success
      </span>
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
        <Hourglass className="h-3 w-3" />
        {formatNumber(data.pending)} Pending
      </span>
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
        <XCircle className="h-3 w-3" />
        {formatNumber(data.failed)} Failed
      </span>
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
      className="group block rounded-2xl border border-ink-100 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
    >
      <div className="flex items-start justify-between">
        <span
          className={cn(
            "grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br text-white shadow-soft",
            accents[accent]
          )}
        >
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <span className="rounded-full bg-ink-50 px-2 py-0.5 text-[11px] font-semibold text-ink-600">
          {formatNumber(data.count)} Txn
        </span>
      </div>
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-widest text-ink-500">
        {label}
      </p>
      <p className="mt-0.5 font-display text-xl font-bold text-ink-900">
        {formatINR(data.amount)}
      </p>
      <StatusPills data={data} />
      <AmountBreakdown data={data} />
    </Link>
  );
}

function TotalBusinessCard({ data, href }: { data: ServiceToday; href: string }) {
  return (
    <Link
      href={href}
      className="group relative block overflow-hidden rounded-2xl bg-gradient-to-br from-brand-700 via-brand-600 to-accent-500 p-4 text-white shadow-glow transition-all hover:-translate-y-0.5 hover:shadow-glow focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
    >
      <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
      <div className="flex items-start justify-between">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/15">
          <IndianRupee className="h-[18px] w-[18px]" />
        </span>
        <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-semibold">
          {formatNumber(data.count)} Txn
        </span>
      </div>
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-widest text-white/80">
        Total Business Today
      </p>
      <p className="mt-0.5 font-display text-xl font-bold">{formatINR(data.amount)}</p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-semibold text-white">
          <CheckCircle2 className="h-3 w-3" />
          {formatNumber(data.success)} Success
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-semibold text-white">
          <Hourglass className="h-3 w-3" />
          {formatNumber(data.pending)} Pending
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-semibold text-white">
          <XCircle className="h-3 w-3" />
          {formatNumber(data.failed)} Failed
        </span>
      </div>
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
      className="group block rounded-2xl border border-ink-100 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
    >
      <div className="flex items-start justify-between">
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
            "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
            positive ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
          )}
        >
          vs yesterday
        </span>
      </div>
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-widest text-ink-500">
        Yesterday vs Today Growth
      </p>
      <p className="mt-0.5 font-display text-xl font-bold text-ink-900">{display}</p>
      <p className="mt-1 text-[11px] text-ink-500">
        Yesterday: {formatINR(summary.yesterdayTotal)}
      </p>
    </Link>
  );
}
