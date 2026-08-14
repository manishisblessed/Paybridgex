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
} from "lucide-react";
import { StatCard } from "@/components/dashboard/StatCard";
import { TransactionsTable } from "@/components/dashboard/TransactionsTable";
import { Sparkline } from "@/components/dashboard/Sparkline";
import { StatSkeleton } from "@/components/ui/Skeleton";
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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-ink-500">{greeting},</p>
          <h1 className="heading-md mt-1">
            {session.name?.split(" ")[0] ?? "there"} 👋
          </h1>
          <p className="mt-1 text-sm text-ink-600">
            Here&apos;s a snapshot of your shop today.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard/funds-request">
            <Button variant="outline">
              <Plus className="h-4 w-4" />
              Request funds
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loadingTxns ? (
          <>
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
          </>
        ) : (
          <>
            <WalletCard balance={session.walletBalance} />
            <StatCard
              label="Today's Volume"
              value={formatINR(todayVolume)}
              icon={IndianRupee}
              accent="emerald"
            />
            <StatCard
              label="Transactions Today"
              value={`${todayCount}`}
              icon={TrendingUp}
              accent="brand"
            />
            <StatCard
              label="Customers Served"
              value={`${txns.filter((t) => t.status === "Success").length}`}
              icon={Users}
              accent="violet"
            />
          </>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-ink-100 bg-white p-5 lg:col-span-2">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-ink-500">
                Volume · recent
              </p>
              <p className="mt-1 font-display text-2xl font-bold text-ink-900">
                {formatINR(volume14d)}
              </p>
            </div>
          </div>
          <div className="mt-4">
            <Sparkline
              values={Array.from({ length: 14 }, () => 0)}
              color="#185df5"
              height={80}
            />
          </div>
          {!loadingTxns && volume14d === 0 && (
            <p className="mt-2 text-xs text-ink-500">
              No transactions yet — your processed volume appears after successful live transactions.
            </p>
          )}
        </div>
        <div className="rounded-2xl border border-dashed border-brand-200 bg-gradient-to-br from-brand-50 to-accent-50 p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-brand-700">
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
            className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline"
          >
            Open wallet <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
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
            className="text-sm font-semibold text-brand-700 hover:underline"
          >
            View all
          </Link>
        </div>
        {quickServices.length === 0 && (
          <div className="rounded-2xl border border-dashed border-ink-200 bg-ink-50/50 p-6 text-center text-sm text-ink-500">
            No services are enabled for your account yet. Contact your admin to
            get services activated.
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          {quickServices.map((s) => {
            const Icon = s.icon;
            return (
              <Link
                key={s.slug}
                href={s.href}
                className={cn(
                  "group flex items-center gap-3 rounded-2xl border border-ink-100 bg-white p-4 transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-soft"
                )}
              >
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-700 transition group-hover:bg-brand-600 group-hover:text-white">
                  <Icon className="h-5 w-5" />
                </span>
                <div>
                  <p className="font-display text-sm font-semibold text-ink-900">
                    {s.title}
                  </p>
                  <p className="text-xs text-ink-500">{s.description.slice(0, 36)}...</p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      <TransactionsTable data={txns} loading={loadingTxns} showCommission={false} />
    </div>
  );
}

function WalletCard({ balance }: { balance: number }) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-700 via-brand-600 to-accent-500 p-5 text-white shadow-glow">
      <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
      <div className="flex items-start justify-between">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-white/15">
          <Wallet className="h-5 w-5" />
        </span>
        <span className="rounded-full bg-white/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-widest">
          NextGenPay Wallet
        </span>
      </div>
      <p className="mt-5 text-xs font-semibold uppercase tracking-widest text-white/80">
        Available balance
      </p>
      <p className="mt-1 font-display text-2xl font-bold">{formatINR(balance)}</p>
      <Link
        href="/dashboard/wallet"
        className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-white/90 hover:text-white"
      >
        Manage wallet <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}
