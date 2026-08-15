"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Users,
  IndianRupee,
  HandCoins,
  TrendingUp,
  CheckCircle2,
  XCircle,
  Inbox,
} from "lucide-react";
import { StatCard } from "@/components/dashboard/StatCard";
import { Sparkline } from "@/components/dashboard/Sparkline";
import { StatSkeleton } from "@/components/ui/Skeleton";
import { Stagger, StaggerItem, Reveal, CountUp } from "@/components/motion";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import type { Session } from "@/lib/auth";
import { formatINR } from "@/lib/utils";

type NetworkRow = {
  id: string;
  name: string;
  shop: string;
  city: string;
  state: string;
  status: string;
  walletBalance: number;
  monthlyTurnover: number;
};

type FundRow = {
  id: string;
  amount: number;
  mode: string;
  utr: string | null;
  status: string;
  requester: { name: string };
};

export function DistributorOverview({ session }: { session: Session }) {
  const [retailers, setRetailers] = useState<NetworkRow[]>([]);
  const [pending, setPending] = useState<FundRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [netRes, fundRes] = await Promise.all([
        fetch("/api/network"),
        fetch("/api/fund-request"),
      ]);
      const net = await netRes.json().catch(() => ({}));
      const funds = await fundRes.json().catch(() => ({}));
      if (Array.isArray(net.users)) setRetailers(net.users);
      if (Array.isArray(funds.requests)) {
        setPending(
          funds.requests.filter(
            (f: FundRow) => f.status === "PENDING" || f.status === "Pending"
          )
        );
      }
    } catch {
      // keep empty live state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const mtdTurnover = retailers.reduce((s, r) => s + (r.monthlyTurnover ?? 0), 0);
  const firstName = session.name?.split(" ")[0] ?? "Your";

  return (
    <div className="space-y-8">
      <Reveal distance={16} duration={0.45}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-700">
              Distributor desk
            </p>
            <h1 className="heading-md mt-1">{firstName}&apos;s network</h1>
            <p className="mt-1 text-sm text-ink-500">
              {retailers.length} retailers · {formatINR(mtdTurnover)} this month
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard/network/onboard">
              <Button variant="outline">
                <Users className="h-4 w-4" />
                Add retailer
              </Button>
            </Link>
            <Link href="/dashboard/funds-request">
              <Button>
                Approve funds
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </Reveal>

      <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" stagger={0.06}>
        {loading ? (
          <>
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
          </>
        ) : (
          <>
            <StaggerItem distance={16} duration={0.4}>
              <StatCard
                label="Active Retailers"
                value={`${retailers.length}`}
                countTo={retailers.length}
                icon={Users}
                accent="brand"
                href="/dashboard/network"
              />
            </StaggerItem>
            <StaggerItem distance={16} duration={0.4}>
              <StatCard
                label="Network Wallet"
                value={formatINR(session.walletBalance)}
                countTo={session.walletBalance}
                prefix="₹"
                decimals={2}
                icon={HandCoins}
                accent="violet"
                href="/dashboard/wallet"
              />
            </StaggerItem>
            <StaggerItem distance={16} duration={0.4}>
              <StatCard
                label="Override Earnings"
                value={formatINR(0)}
                countTo={0}
                prefix="₹"
                decimals={2}
                icon={IndianRupee}
                accent="emerald"
                href="/dashboard/earnings"
              />
            </StaggerItem>
            <StaggerItem distance={16} duration={0.4}>
              <StatCard
                label="Network Turnover (MTD)"
                value={formatINR(mtdTurnover)}
                countTo={mtdTurnover}
                prefix="₹"
                decimals={2}
                icon={TrendingUp}
                accent="accent"
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
                  Network turnover · last 14 days
                </p>
                <p className="mt-1 font-display text-2xl font-bold text-ink-900">
                  <CountUp value={mtdTurnover} prefix="₹" decimals={2} duration={1.2} />
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
            {!loading && mtdTurnover === 0 && (
              <p className="mt-2 text-xs text-ink-500">
                No turnover yet — updates as retailers process live transactions.
              </p>
            )}
          </div>
        </Reveal>

        <Reveal distance={18} duration={0.5} delay={0.08}>
          <div className="h-full rounded-2xl border border-ink-100 bg-white p-5 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-widest text-ink-500">
              Pending fund requests
            </p>
            <p className="mt-1 font-display text-2xl font-bold text-ink-900">
              {loading ? "…" : <CountUp value={pending.length} duration={0.9} />}
            </p>
            {pending.length === 0 && !loading ? (
              <div className="mt-4 flex items-center gap-2 rounded-xl border border-dashed border-ink-200 bg-ink-50/50 px-3 py-3 text-sm text-ink-500">
                <Inbox className="h-4 w-4 text-ink-300" />
                No pending requests.
              </div>
            ) : (
              <ul className="mt-4 space-y-3">
                {pending.slice(0, 3).map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center justify-between rounded-xl border border-ink-100 px-3 py-2 transition-colors hover:border-brand-200"
                  >
                    <div>
                      <p className="text-sm font-semibold text-ink-900">
                        {f.requester?.name ?? "Retailer"}
                      </p>
                      <p className="text-xs text-ink-500">
                        {f.mode}
                        {f.utr ? ` · ${f.utr}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-display text-sm font-bold text-ink-900">
                        {formatINR(f.amount)}
                      </span>
                      <Link
                        href="/dashboard/funds-request"
                        className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-100 text-emerald-700 transition-colors hover:bg-emerald-600 hover:text-white"
                        aria-label="Review"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                      </Link>
                      <Link
                        href="/dashboard/funds-request"
                        className="grid h-7 w-7 place-items-center rounded-lg bg-rose-100 text-rose-700 transition-colors hover:bg-rose-600 hover:text-white"
                        aria-label="Review"
                      >
                        <XCircle className="h-4 w-4" />
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href="/dashboard/funds-request"
              className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 transition-colors hover:text-brand-600"
            >
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </Reveal>
      </div>

      <Reveal distance={18} duration={0.5}>
        <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
            <div>
              <h3 className="flex items-center gap-2 font-display text-base font-semibold text-ink-900">
                <span className="inline-block h-4 w-1 rounded-full bg-gradient-to-b from-brand-500 to-accent-500" aria-hidden />
                Top retailers
              </h3>
              <p className="mt-0.5 text-xs text-ink-500">Sorted by monthly turnover</p>
            </div>
            <Link
              href="/dashboard/network"
              className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 transition-colors hover:text-brand-600"
            >
              Manage all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {retailers.length === 0 && !loading ? (
            <div className="flex flex-col items-center gap-3 px-5 py-12 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-2xl border border-dashed border-ink-200 bg-ink-50/60 text-ink-300">
                <Users className="h-5 w-5" />
              </span>
              <p className="max-w-xs text-sm text-ink-500">
                No retailers yet. Onboard a retailer to start live transactions.
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-ink-50/60 text-left text-[11px] uppercase tracking-wider text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Retailer</th>
                  <th className="px-5 py-3 font-semibold">City</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 font-semibold text-right">Wallet</th>
                  <th className="px-5 py-3 font-semibold text-right">MTD Turnover</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100/80 text-ink-800">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-12 text-center text-sm text-ink-500">
                      Loading retailers…
                    </td>
                  </tr>
                ) : (
                  [...retailers]
                    .sort((a, b) => b.monthlyTurnover - a.monthlyTurnover)
                    .map((r) => (
                      <tr key={r.id} className="transition-colors duration-150 hover:bg-brand-50/40">
                        <td className="px-5 py-3">
                          <div className="font-semibold text-ink-900">{r.name}</div>
                          <div className="text-xs text-ink-500">
                            {r.shop} · {r.id.slice(0, 10)}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-ink-600">
                          {r.city}, {r.state}
                        </td>
                        <td className="px-5 py-3">
                          <Badge
                            variant={
                              r.status === "Active"
                                ? "success"
                                : r.status === "Pending KYC"
                                  ? "warning"
                                  : "danger"
                            }
                          >
                            {r.status}
                          </Badge>
                        </td>
                        <td className="px-5 py-3 text-right font-semibold">
                          {formatINR(r.walletBalance)}
                        </td>
                        <td className="px-5 py-3 text-right font-semibold text-accent-700">
                          {formatINR(r.monthlyTurnover)}
                        </td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </Reveal>
    </div>
  );
}
