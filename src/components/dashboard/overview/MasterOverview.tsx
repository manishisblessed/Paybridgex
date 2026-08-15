"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Network,
  Users,
  IndianRupee,
  TrendingUp,
  Globe,
  KeyRound,
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
  retailers: number;
  status: string;
  walletBalance: number;
  monthlyTurnover: number;
};

type WhiteLabel = {
  customDomain?: string | null;
  subdomain?: string | null;
  status?: string | null;
};

export function MasterOverview({ session }: { session: Session }) {
  const isSuper = session.role === "super-distributor";
  const childLabel = isSuper ? "master distributors" : "distributors";
  const [children, setChildren] = useState<NetworkRow[]>([]);
  const [wl, setWl] = useState<WhiteLabel | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [netRes, wlRes] = await Promise.all([
        fetch("/api/network"),
        fetch("/api/platform/whitelabel"),
      ]);
      const net = await netRes.json().catch(() => ({}));
      const wlData = await wlRes.json().catch(() => ({}));
      if (Array.isArray(net.users)) setChildren(net.users);
      if (wlData?.profile) setWl(wlData.profile);
      else if (wlData?.customDomain || wlData?.subdomain) setWl(wlData);
    } catch {
      // keep empty live state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totalRetailers = children.reduce((s, d) => s + (d.retailers ?? 0), 0);
  const mtdTurnover = children.reduce((s, d) => s + (d.monthlyTurnover ?? 0), 0);
  const domain =
    wl?.customDomain ||
    (wl?.subdomain ? `${wl.subdomain}.paybridgex.in` : null);

  return (
    <div className="space-y-8">
      <Reveal distance={16} duration={0.45}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-700">
              {isSuper ? "Super distributor desk" : "Master distributor desk"}
            </p>
            <h1 className="heading-md mt-1">{session.name}</h1>
            <p className="mt-1 text-sm text-ink-500">
              {children.length} {childLabel} · {totalRetailers} retailers
              {domain ? " · white-label configured" : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard/api">
              <Button variant="outline">
                <KeyRound className="h-4 w-4" />
                API keys
              </Button>
            </Link>
            <Link href="/dashboard/network/onboard">
              <Button>
                Add {isSuper ? "master distributor" : "distributor"}
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
                label={isSuper ? "Master Distributors" : "Distributors"}
                value={`${children.length}`}
                countTo={children.length}
                icon={Network}
                accent="brand"
                href="/dashboard/network"
              />
            </StaggerItem>
            <StaggerItem distance={16} duration={0.4}>
              <StatCard
                label="Retailers (network)"
                value={`${totalRetailers.toLocaleString("en-IN")}`}
                countTo={totalRetailers}
                icon={Users}
                accent="violet"
              />
            </StaggerItem>
            <StaggerItem distance={16} duration={0.4}>
              <StatCard
                label="Override Earnings (MTD)"
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
                color="#10b981"
                height={80}
              />
            </div>
            {!loading && mtdTurnover === 0 && (
              <p className="mt-2 text-xs text-ink-500">
                No network turnover yet — figures update as live transactions clear.
              </p>
            )}
          </div>
        </Reveal>
        <Reveal distance={18} duration={0.5} delay={0.08}>
          <div className="relative h-full overflow-hidden rounded-2xl border border-ink-100 bg-[#0b1030] p-5 text-white">
            <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-brand-500/30 blur-2xl" aria-hidden />
            <div className="relative flex items-center gap-2 text-accent-300">
              <Globe className="h-4 w-4" />
              <p className="text-[11px] font-bold uppercase tracking-widest">
                White-label portal
              </p>
            </div>
            <p className="relative mt-3 font-display text-lg font-semibold">
              {domain ?? "Not configured"}
            </p>
            <p className="relative mt-1 text-sm text-white/60">
              {domain
                ? "Manage co-branded portal settings for your downline."
                : "Set a custom domain or subdomain for your distributors."}
            </p>
            <Link
              href="/dashboard/whitelabel"
              className="relative mt-4 inline-flex items-center gap-1 text-sm font-semibold text-accent-300 transition-colors hover:text-accent-200"
            >
              {domain ? "Manage branding" : "Set up branding"}{" "}
              <ArrowRight className="h-3 w-3" />
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
                My {childLabel}
              </h3>
              <p className="mt-0.5 text-xs text-ink-500">
                Direct child {childLabel} with live wallet &amp; turnover
              </p>
            </div>
            <Link
              href="/dashboard/network"
              className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 transition-colors hover:text-brand-600"
            >
              View tree <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {children.length === 0 && !loading ? (
            <div className="flex flex-col items-center gap-3 px-5 py-12 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-2xl border border-dashed border-ink-200 bg-ink-50/60 text-ink-300">
                <Network className="h-5 w-5" />
              </span>
              <p className="max-w-xs text-sm text-ink-500">
                No {childLabel} yet. Onboard your first partner to build the network.
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-ink-50/60 text-left text-[11px] uppercase tracking-wider text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">
                    {isSuper ? "Master distributor" : "Distributor"}
                  </th>
                  <th className="px-5 py-3 font-semibold">Region</th>
                  <th className="px-5 py-3 font-semibold">Downline</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 font-semibold text-right">Wallet</th>
                  <th className="px-5 py-3 font-semibold text-right">MTD Turnover</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100/80 text-ink-800">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-sm text-ink-500">
                      Loading network…
                    </td>
                  </tr>
                ) : (
                  children.map((d) => (
                    <tr key={d.id} className="transition-colors duration-150 hover:bg-brand-50/40">
                      <td className="px-5 py-3">
                        <div className="font-semibold text-ink-900">{d.name}</div>
                        <div className="text-xs text-ink-500">
                          {d.shop} · {d.id.slice(0, 10)}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-ink-600">
                        {d.city}, {d.state}
                      </td>
                      <td className="px-5 py-3 font-semibold">{d.retailers}</td>
                      <td className="px-5 py-3">
                        <Badge
                          variant={
                            d.status === "Active"
                              ? "success"
                              : d.status === "Pending KYC"
                                ? "warning"
                                : "danger"
                          }
                        >
                          {d.status}
                        </Badge>
                      </td>
                      <td className="px-5 py-3 text-right font-semibold">
                        {formatINR(d.walletBalance)}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold text-accent-700">
                        {formatINR(d.monthlyTurnover)}
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
