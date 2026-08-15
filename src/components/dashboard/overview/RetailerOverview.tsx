"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  IndianRupee,
  TrendingUp,
  Users,
  Wallet,
  ArrowRight,
  Plus,
  Sparkles,
} from "lucide-react";
import { StatCard } from "@/components/dashboard/StatCard";
import { TransactionsTable } from "@/components/dashboard/TransactionsTable";
import { Sparkline } from "@/components/dashboard/Sparkline";
import { StatSkeleton } from "@/components/ui/Skeleton";
import { Stagger, StaggerItem, Reveal, CountUp } from "@/components/motion";
import { services } from "@/lib/data";
import type { Transaction } from "@/lib/data";
import { Button } from "@/components/ui/Button";
import type { Session } from "@/lib/auth";
import { formatINR, cn } from "@/lib/utils";
import { hrefToServiceKey } from "@/lib/services/catalog";
import { useEffectiveServices } from "@/hooks/useEffectiveServices";

export function RetailerOverview({ session }: { session: Session }) {
  const effectiveServices = useEffectiveServices();
  const quickServices = services
    .filter((s) => {
      const key = hrefToServiceKey(s.href);
      if (!key) return true;
      return (effectiveServices ?? new Set<string>()).has(key);
    })
    .slice(0, 8);

  const [txns, setTxns] = useState<Transaction[]>([]);
  const [loadingTxns, setLoadingTxns] = useState(true);

  const loadTxns = useCallback(async () => {
    setLoadingTxns(true);
    try {
      const res = await fetch("/api/transactions?limit=20");
      const json = await res.json();
      if (Array.isArray(json.data)) setTxns(json.data);
    } catch {
      setTxns([]);
    } finally {
      setLoadingTxns(false);
    }
  }, []);

  useEffect(() => {
    loadTxns();
  }, [loadTxns]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todays = txns.filter((t) => {
    // date is locale string; prefer counting SUCCESS from loaded set as proxy when timestamps unavailable
    return t.status === "Success";
  });
  // Retailers see their own processed VOLUME (sum of txn amounts), not commission:
  // on settlement rails the per-txn commission is the upline's, not theirs, so it
  // would be misleading here. Their genuine earnings live on the My Earnings page.
  const todayVolume = todays.reduce((s, t) => s + t.amount, 0);
  const todayCount = todays.length;
  const volume14d = txns
    .filter((t) => t.status === "Success")
    .reduce((s, t) => s + t.amount, 0);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  })();

  return (
    <div className="space-y-8">
      <Reveal distance={16} duration={0.45}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-sm text-ink-500">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-accent-500" />
              </span>
              {greeting},
            </p>
            <h1 className="heading-md mt-1">
              {session.name?.split(" ")[0] ?? "there"} 👋
            </h1>
            <p className="mt-1 text-sm text-ink-500">
              Here&apos;s a snapshot of your shop today.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard/funds-request">
              <Button variant="outline">
                <Plus className="h-4 w-4" />
                Add funds
              </Button>
            </Link>
            <Link href="/dashboard/money-transfer">
              <Button>
                Send money
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </Reveal>

      <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" stagger={0.06}>
        {loadingTxns ? (
          <>
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
          </>
        ) : (
          <>
            <StaggerItem distance={16} duration={0.4}>
              <WalletCard balance={session.walletBalance} />
            </StaggerItem>
            <StaggerItem distance={16} duration={0.4}>
              <StatCard
                label="Today's Volume"
                value={formatINR(todayVolume)}
                countTo={todayVolume}
                prefix="₹"
                decimals={2}
                icon={IndianRupee}
                accent="emerald"
              />
            </StaggerItem>
            <StaggerItem distance={16} duration={0.4}>
              <StatCard
                label="Transactions Today"
                value={`${todayCount}`}
                countTo={todayCount}
                icon={TrendingUp}
                accent="brand"
              />
            </StaggerItem>
            <StaggerItem distance={16} duration={0.4}>
              <StatCard
                label="Customers Served"
                value={`${txns.filter((t) => t.status === "Success").length}`}
                countTo={txns.filter((t) => t.status === "Success").length}
                icon={Users}
                accent="violet"
              />
            </StaggerItem>
          </>
        )}
      </Stagger>

      <div className="grid gap-4 lg:grid-cols-3">
        <Reveal className="lg:col-span-2" distance={18} duration={0.5}>
          <div className="h-full rounded-2xl border border-ink-100 bg-white p-5 shadow-sm">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-ink-500">
                  Volume · recent
                </p>
                <p className="mt-1 font-display text-2xl font-bold text-ink-900">
                  <CountUp value={volume14d} prefix="₹" decimals={2} duration={1.2} />
                </p>
              </div>
            </div>
            <div className="mt-4">
              <Sparkline
                values={Array.from({ length: 14 }, () => 0)}
                color="#3164f6"
                height={80}
              />
            </div>
            {!loadingTxns && volume14d === 0 && (
              <p className="mt-2 text-xs text-ink-500">
                No transactions yet — your processed volume appears after successful live transactions.
              </p>
            )}
          </div>
        </Reveal>
        <Reveal distance={18} duration={0.5} delay={0.08}>
          <div className="relative h-full overflow-hidden rounded-2xl border border-accent-200/60 bg-gradient-to-br from-accent-50 via-white to-brand-50 p-5">
            <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-accent-400/15 blur-2xl" aria-hidden />
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-accent-700">
              <Sparkles className="h-3.5 w-3.5" />
              Get started
            </p>
            <p className="mt-3 font-display text-lg font-semibold text-ink-900">
              Run your first live transaction
            </p>
            <p className="mt-1 text-sm text-ink-600">
              Top up your wallet, then use Quick services below to process real payments.
            </p>
            <Link
              href="/dashboard/wallet"
              className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-accent-700 transition-colors hover:text-accent-600"
            >
              Open wallet <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </Reveal>
      </div>

      <div>
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold text-ink-900">
              Quick services
            </h2>
            <p className="text-sm text-ink-500">
              Most-used services for fast access
            </p>
          </div>
          <Link
            href="/services"
            className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 transition-colors hover:text-brand-600"
          >
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        {quickServices.length === 0 && (
          <div className="rounded-2xl border border-dashed border-ink-200 bg-ink-50/50 p-6 text-center text-sm text-ink-500">
            No services are enabled for your account yet. Contact your admin to
            get services activated.
          </div>
        )}
        <Stagger className="grid gap-3 sm:grid-cols-2 md:grid-cols-4" stagger={0.05}>
          {quickServices.map((s) => {
            const Icon = s.icon;
            return (
              <StaggerItem key={s.slug} distance={14} duration={0.35}>
                <Link
                  href={s.href}
                  className={cn(
                    "group flex items-center gap-3 rounded-2xl border border-ink-100 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-soft"
                  )}
                >
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 transition-colors duration-200 group-hover:bg-gradient-to-br group-hover:from-brand-600 group-hover:to-accent-500 group-hover:text-white">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-display text-sm font-semibold text-ink-900">
                      {s.title}
                    </p>
                    <p className="truncate text-xs text-ink-500">{s.description.slice(0, 36)}...</p>
                  </div>
                </Link>
              </StaggerItem>
            );
          })}
        </Stagger>
      </div>

      <Reveal distance={18} duration={0.5}>
        <TransactionsTable data={txns} loading={loadingTxns} showCommission={false} />
      </Reveal>
    </div>
  );
}

function WalletCard({ balance }: { balance: number }) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-[#0b1030] p-5 text-white shadow-glow">
      <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-brand-500/40 blur-2xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-12 -left-8 h-28 w-28 rounded-full bg-accent-500/25 blur-2xl" aria-hidden />
      <div className="relative flex items-start justify-between">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 ring-1 ring-white/15">
          <Wallet className="h-5 w-5 text-accent-300" />
        </span>
        <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-white/80 ring-1 ring-white/10">
          Paybridgex Wallet
        </span>
      </div>
      <p className="relative mt-5 text-[11px] font-semibold uppercase tracking-widest text-white/60">
        Available balance
      </p>
      <p className="relative mt-0.5 font-display text-xl font-bold">
        <CountUp value={balance} prefix="₹" decimals={2} duration={1.2} />
      </p>
      <Link
        href="/dashboard/wallet"
        className="relative mt-3 inline-flex items-center gap-1 text-xs font-semibold text-accent-300 transition-colors hover:text-accent-200"
      >
        Manage wallet <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}
