"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Wallet,
  Landmark,
  Globe,
  Eye,
  EyeOff,
  RefreshCw,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";

/**
 * Cumulative Wallet Balances — the platform's liability control tower.
 *
 * Three headline buckets sit side-by-side:
 *   1. Total Primary Wallet    (sum of walletBalance across network tiers)
 *   2. Total AEPS Wallet       (sum of aepsBalance across network tiers)
 *   3. API Partner Wallets     (sum of upstream provider floats)
 *
 * Each bucket carries a per-tier breakdown so ops can spot concentration
 * at a glance. Uses a dark, premium surface to visually anchor the page.
 */

type TierBalance = {
  role: string;
  users: number;
  primary: number;
  aeps: number;
  total: number;
};

export type CumulativeData = {
  systemTotal: number;
  primaryTotal: number;
  aepsTotal: number;
  heldTotal: number;
  walletCount: number;
  tiers: TierBalance[];
};

export type PartnerFloat = {
  key: string;
  name: string;
  balance: number | null;
  configured: boolean;
  error?: string | null;
};

const TIER_ORDER = [
  "RETAILER",
  "DISTRIBUTOR",
  "MASTER_DISTRIBUTOR",
  "SUPER_DISTRIBUTOR",
] as const;

const TIER_LABEL: Record<string, string> = {
  RETAILER: "Retailers (RT)",
  DISTRIBUTOR: "Distributors (DT)",
  MASTER_DISTRIBUTOR: "Master Distributors (MD)",
  SUPER_DISTRIBUTOR: "Super-Distributors (SD)",
};

export function CumulativeWalletCard({
  data,
  partners,
  loading,
  onRefresh,
  refreshing,
}: {
  data: CumulativeData | null;
  partners: PartnerFloat[] | null;
  loading: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const [masked, setMasked] = useState(false);

  const money = (n: number) => (masked ? "₹ ●●●●●" : formatINRFull(n));

  const tiers = orderTiers(data?.tiers ?? []);
  const partnerTotal = (partners ?? []).reduce(
    (a, p) => a + (typeof p.balance === "number" ? p.balance : 0),
    0
  );
  const partnersConfigured = (partners ?? []).filter((p) => p.configured).length;

  const systemGrandTotal = (data?.systemTotal ?? 0) + partnerTotal;

  // B2F Wallet: API partner float (excluding eKYC Hub credits) net of the
  // primary wallet liability we owe the network.
  const b2fPartnerTotal = (partners ?? []).reduce(
    (a, p) =>
      a + (p.key !== "ekychub" && typeof p.balance === "number" ? p.balance : 0),
    0
  );
  const b2fWallet = b2fPartnerTotal - (data?.primaryTotal ?? 0);

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-3xl border border-white/10 p-5 text-white shadow-[0_25px_80px_-25px_rgba(9,13,37,0.55)]",
        "bg-[radial-gradient(120%_120%_at_0%_0%,#16255c_0%,#0b1030_45%,#070a1c_100%)]"
      )}
    >
      {/* accent glows */}
      <div className="pointer-events-none absolute -top-24 -left-24 h-64 w-64 rounded-full bg-brand-500/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 right-10 h-56 w-72 rounded-full bg-violet-500/15 blur-3xl" />

      <header className="relative flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-teal-400 to-emerald-600 text-white shadow-lg shadow-emerald-900/30">
            <Wallet className="h-5 w-5" strokeWidth={2.2} />
          </span>
          <div>
            <h2 className="font-display text-lg font-bold tracking-tight">
              Cumulative Wallet Balances
            </h2>
            <p className="text-xs text-slate-400">
              Total user funds held across the platform (liability view)
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-right"
            title="API Partner Wallets (excl. eKYC Hub credits) − Total Primary Wallet"
          >
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              B2F Wallet
            </p>
            <p
              className={cn(
                "font-display text-sm font-bold",
                loading || partners === null
                  ? "text-white/30"
                  : b2fWallet < 0
                  ? "text-rose-300"
                  : "text-emerald-300"
              )}
            >
              {partners === null ? "₹ ————" : money(b2fWallet)}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-right">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              System Total
            </p>
            <p className="font-display text-sm font-bold text-white">
              {money(systemGrandTotal)}
            </p>
          </div>
          <IconBtn
            onClick={() => setMasked((m) => !m)}
            title={masked ? "Show amounts" : "Mask amounts"}
          >
            {masked ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </IconBtn>
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-md shadow-emerald-900/30 transition hover:brightness-110 disabled:opacity-60"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            Refresh
          </button>
        </div>
      </header>

      <div className="relative mt-4 grid gap-3 lg:grid-cols-3">
        <BucketCard
          title="Total Primary Wallet"
          subtitle={`${formatNumber(data?.walletCount ?? 0)} wallets`}
          amount={money(data?.primaryTotal ?? 0)}
          loading={loading}
          icon={<Wallet className="h-5 w-5" strokeWidth={2.3} />}
          tint="teal"
          tiers={tiers.map((t) => ({
            label: TIER_LABEL[t.role] ?? t.role,
            value: money(t.primary),
          }))}
        />

        <BucketCard
          title="Total AEPS Wallet"
          subtitle={`${formatNumber(data?.walletCount ?? 0)} wallets`}
          amount={money(data?.aepsTotal ?? 0)}
          loading={loading}
          icon={<Landmark className="h-5 w-5" strokeWidth={2.3} />}
          tint="amber"
          tiers={tiers.map((t) => ({
            label: TIER_LABEL[t.role] ?? t.role,
            value: money(t.aeps),
          }))}
        />

        <BucketCard
          title="API Partner Wallets"
          subtitle={
            partners === null
              ? "loading partners…"
              : `${partnersConfigured} partner${partnersConfigured === 1 ? "" : "s"} · separate wallet system`
          }
          amount={money(partnerTotal)}
          loading={loading || partners === null}
          icon={<Globe className="h-5 w-5" strokeWidth={2.3} />}
          tint="violet"
          tiers={(partners ?? []).slice(0, 4).map((p) => ({
            label: p.name,
            value: !p.configured
              ? "not set"
              : p.error
              ? "unreachable"
              : money(p.balance ?? 0),
            dim: !p.configured || !!p.error,
          }))}
          footer={
            <Link
              href="/dashboard/admin/services"
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-violet-200/80 transition hover:text-white"
            >
              Manage providers <ArrowRight className="h-3 w-3" />
            </Link>
          }
        />
      </div>

      {(data?.heldTotal ?? 0) > 0 && !loading && (
        <div className="relative mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-xs text-slate-300">
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-amber-300" />
            <b className="text-white">{money(data!.heldTotal)}</b> currently
            on-hold across in-flight settlements.
          </span>
          <Link
            href="/dashboard/admin/wallet-ops"
            className="text-brand-200 hover:text-white"
          >
            Open wallet ops →
          </Link>
        </div>
      )}
    </section>
  );
}

/* ── sub-components ────────────────────────────────────────────────── */

function BucketCard({
  title,
  subtitle,
  amount,
  icon,
  tint,
  tiers,
  loading,
  footer,
}: {
  title: string;
  subtitle: string;
  amount: string;
  icon: React.ReactNode;
  tint: "teal" | "amber" | "violet";
  tiers: { label: string; value: string; dim?: boolean }[];
  loading: boolean;
  footer?: React.ReactNode;
}) {
  const iconBg: Record<typeof tint, string> = {
    teal: "from-teal-400 to-emerald-600 shadow-emerald-900/30",
    amber: "from-amber-400 to-orange-600 shadow-orange-900/30",
    violet: "from-fuchsia-400 to-violet-600 shadow-violet-900/30",
  };
  const glow: Record<typeof tint, string> = {
    teal: "from-teal-400/25 to-transparent",
    amber: "from-orange-400/25 to-transparent",
    violet: "from-violet-400/25 to-transparent",
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 backdrop-blur-sm">
      <div
        className={cn(
          "pointer-events-none absolute -top-16 -right-10 h-40 w-40 rounded-full bg-gradient-to-br blur-2xl",
          glow[tint]
        )}
      />
      <div className="relative flex items-center gap-3">
        <span
          className={cn(
            "grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-lg",
            iconBg[tint]
          )}
        >
          {icon}
        </span>
        <div className="min-w-0">
          <h3 className="font-display text-sm font-bold text-white">{title}</h3>
          <p className="truncate text-[11px] text-slate-400">{subtitle}</p>
        </div>
      </div>

      <p
        className={cn(
          "relative mt-3 font-display text-[26px] font-bold leading-tight text-white",
          loading && "animate-pulse text-white/30"
        )}
      >
        {loading ? "₹ ————" : amount}
      </p>

      <ul className="relative mt-3 divide-y divide-white/[0.06] rounded-xl border border-white/[0.06] bg-black/20">
        {tiers.map((t, i) => (
          <li
            key={`${t.label}-${i}`}
            className="flex items-center justify-between px-3 py-2 text-xs"
          >
            <span className="truncate text-slate-300">{t.label}</span>
            <span
              className={cn(
                "shrink-0 font-semibold tabular-nums",
                t.dim ? "text-slate-500" : "text-white"
              )}
            >
              {t.value}
            </span>
          </li>
        ))}
        {tiers.length === 0 && (
          <li className="px-3 py-3 text-center text-[11px] text-slate-500">
            no rows
          </li>
        )}
      </ul>

      {footer}
    </div>
  );
}

function IconBtn({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="grid h-8 w-8 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-300 transition hover:bg-white/[0.08] hover:text-white"
    >
      {children}
    </button>
  );
}

/* ── helpers ───────────────────────────────────────────────────────── */

function orderTiers(tiers: TierBalance[]): TierBalance[] {
  const map = new Map(tiers.map((t) => [t.role, t]));
  return TIER_ORDER.filter((r) => map.has(r)).map((r) => map.get(r)!);
}

export function formatINRFull(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}
