"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Wallet,
  Radio,
  Eye,
  EyeOff,
  RefreshCw,
  ArrowRight,
  ShieldAlert,
  CircleDot,
  CreditCard,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatINRFull } from "./CumulativeWalletCard";
import type { PartnerFloat } from "./CumulativeWalletCard";

/**
 * Provider Wallets — live float sitting with each upstream API partner.
 *
 * Every card is self-contained: shows configuration status, the last
 * observed balance (or the underlying probe error), and a per-provider
 * refresh handle. A best-effort probe on the server means one dead
 * partner never blanks the whole panel — only that tile flips to Error.
 */

type ProviderExtra = PartnerFloat & {
  provider?: string;
  detail?: string | null;
};

const PROVIDER_META: Record<
  string,
  { subtitle: string; tint: "teal" | "violet" | "emerald" | "amber" | "sky"; icon: React.ComponentType<{ className?: string }> }
> = {
  sameday_settlement: {
    subtitle: "Settlement wallet · Same Day",
    tint: "teal",
    icon: Wallet,
  },
  ekychub: {
    subtitle: "KYC & Verification credits",
    tint: "emerald",
    icon: ShieldCheck,
  },
};

const TINT: Record<string, { icon: string; glow: string; ring: string }> = {
  teal:    { icon: "from-teal-400 to-emerald-600 shadow-emerald-900/30", glow: "from-teal-400/20 to-transparent",   ring: "ring-teal-400/40" },
  violet:  { icon: "from-fuchsia-400 to-violet-600 shadow-violet-900/30", glow: "from-violet-400/20 to-transparent", ring: "ring-violet-400/40" },
  emerald: { icon: "from-emerald-400 to-green-600 shadow-emerald-900/30", glow: "from-emerald-400/20 to-transparent", ring: "ring-emerald-400/40" },
  amber:   { icon: "from-amber-400 to-orange-600 shadow-orange-900/30", glow: "from-amber-400/20 to-transparent",  ring: "ring-amber-400/40" },
  sky:     { icon: "from-sky-400 to-blue-600 shadow-blue-900/30",       glow: "from-sky-400/20 to-transparent",    ring: "ring-sky-400/40" },
};

export function ProviderWalletsCard({
  providers,
  errorMessage,
  loading,
  onRefreshAll,
  refreshing,
  asOf,
}: {
  providers: ProviderExtra[] | null;
  errorMessage: string | null;
  loading: boolean;
  onRefreshAll: () => void;
  refreshing: boolean;
  asOf: Date | null;
}) {
  const [masked, setMasked] = useState(false);
  const money = (n: number | null | undefined) =>
    masked ? "₹ ●●●●●" : formatINRFull(n ?? 0);

  const visibleProviders = (providers ?? []).filter((p) => p.key !== "bulkpe");

  const totalAvailable = visibleProviders.reduce(
    (a, p) => a + (typeof p.balance === "number" ? p.balance : 0),
    0
  );

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-3xl border border-white/10 p-5 text-white shadow-[0_25px_80px_-25px_rgba(9,13,37,0.55)]",
        "bg-[radial-gradient(120%_120%_at_0%_100%,#1a1240_0%,#0b1030_45%,#070a1c_100%)]"
      )}
    >
      <div className="pointer-events-none absolute -top-16 -left-10 h-56 w-72 rounded-full bg-violet-500/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-16 h-56 w-72 rounded-full bg-fuchsia-500/15 blur-3xl" />

      <header className="relative flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="relative grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-fuchsia-400 to-violet-600 text-white shadow-lg shadow-violet-900/30">
            <Radio className="h-5 w-5" strokeWidth={2.2} />
            <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-emerald-400 ring-2 ring-[#0b1030]" />
          </span>
          <div>
            <h2 className="font-display text-lg font-bold tracking-tight">
              Provider Wallets
            </h2>
            <p className="text-xs text-slate-400">
              Live balances across all upstream API providers
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-right">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Total Available
            </p>
            <p className="font-display text-sm font-bold text-white">
              {money(totalAvailable)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setMasked((m) => !m)}
            title={masked ? "Show amounts" : "Mask amounts"}
            className="grid h-8 w-8 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-300 transition hover:bg-white/[0.08] hover:text-white"
          >
            {masked ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={onRefreshAll}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-3 py-1.5 text-xs font-semibold text-white shadow-md shadow-violet-900/30 transition hover:brightness-110 disabled:opacity-60"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            Refresh All
          </button>
        </div>
      </header>

      <div className="relative mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {loading && !providers && (
          <>
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4"
              >
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-2xl bg-white/10" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-24 rounded bg-white/10" />
                    <div className="h-2.5 w-32 rounded bg-white/10" />
                  </div>
                </div>
                <div className="mt-4 h-12 rounded-xl bg-white/10" />
              </div>
            ))}
          </>
        )}

        {!loading && providers && providers.length === 0 && errorMessage && (
          <div className="col-span-full rounded-2xl border border-rose-400/20 bg-rose-500/10 p-4 text-sm text-rose-100">
            <ShieldAlert className="mr-1 inline h-4 w-4 -translate-y-0.5" />
            {errorMessage}
          </div>
        )}

        {visibleProviders.map((p) => (
          <ProviderTile key={p.key} p={p} money={money} />
        ))}
      </div>

      <footer className="relative mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
        <Link
          href="/dashboard/admin/services"
          className="inline-flex items-center gap-1 font-semibold text-brand-200 transition hover:text-white"
        >
          Open service registry <ArrowRight className="h-3 w-3" />
        </Link>
        <span>{asOf ? `Updated ${formatTime(asOf)}` : "…"}</span>
      </footer>
    </section>
  );
}

/* ── individual provider tile ─────────────────────────────────────── */

function ProviderTile({
  p,
  money,
}: {
  p: ProviderExtra;
  money: (n: number | null | undefined) => string;
}) {
  const meta = PROVIDER_META[p.key] ?? {
    subtitle: p.provider ?? "API partner",
    tint: "sky" as const,
    icon: CreditCard,
  };
  const t = TINT[meta.tint];
  const Icon = meta.icon;

  const state: "ok" | "error" | "not-configured" | "frozen" = !p.configured
    ? "not-configured"
    : p.error
    ? "error"
    : p.detail?.startsWith("FROZEN")
    ? "frozen"
    : "ok";

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 backdrop-blur-sm transition hover:border-white/20">
      <div
        className={cn(
          "pointer-events-none absolute -top-16 -right-10 h-40 w-40 rounded-full bg-gradient-to-br blur-2xl opacity-70",
          t.glow
        )}
      />

      <div className="relative flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              "grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-lg",
              t.icon
            )}
          >
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-display text-sm font-bold text-white">
              {p.name}
            </p>
            <p className="truncate text-[11px] text-slate-400">
              {meta.subtitle}
            </p>
          </div>
        </div>
        <StatusBadge state={state} />
      </div>

      <div className="relative mt-3 rounded-xl border border-white/[0.06] bg-black/25 p-3">
        {state === "ok" && (
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Available
            </span>
            <span className="font-display text-lg font-bold tabular-nums text-white">
              {money(p.balance)}
            </span>
          </div>
        )}
        {state === "frozen" && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-amber-300">
              Frozen
            </p>
            <p className="mt-0.5 truncate text-[11px] text-slate-200" title={p.detail ?? ""}>
              {p.detail}
            </p>
            <p className="mt-1 font-display text-base font-bold tabular-nums text-white">
              {money(p.balance)}
            </p>
          </div>
        )}
        {state === "error" && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-rose-300">
              Probe error
            </p>
            <p
              className="mt-0.5 line-clamp-2 text-[11px] text-rose-100/90"
              title={p.error ?? ""}
            >
              {p.error}
            </p>
          </div>
        )}
        {state === "not-configured" && (
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-slate-400">
              Credentials not on file for this rail.
            </p>
            <Link
              href="/dashboard/admin/services"
              className="text-[11px] font-semibold text-brand-200 hover:text-white"
            >
              Configure →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ state }: { state: "ok" | "error" | "not-configured" | "frozen" }) {
  const styles = {
    ok: "bg-emerald-500/15 text-emerald-200 ring-emerald-400/30",
    error: "bg-rose-500/15 text-rose-200 ring-rose-400/30",
    frozen: "bg-amber-500/15 text-amber-200 ring-amber-400/30",
    "not-configured": "bg-slate-500/15 text-slate-300 ring-slate-400/20",
  } as const;
  const label = {
    ok: "Active",
    error: "Error",
    frozen: "Frozen",
    "not-configured": "Off",
  } as const;
  const icon = {
    ok: <CircleDot className="h-3 w-3" />,
    error: <ShieldAlert className="h-3 w-3" />,
    frozen: <Zap className="h-3 w-3" />,
    "not-configured": <CircleDot className="h-3 w-3" />,
  } as const;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ring-1",
        styles[state]
      )}
    >
      {icon[state]}
      {label[state]}
    </span>
  );
}

function formatTime(d: Date) {
  return d.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
