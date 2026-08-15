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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-ink-500">
            {isSuper ? "Super distributor desk" : "Master distributor desk"}
          </p>
          <h1 className="heading-md mt-1">{session.name}</h1>
          <p className="mt-1 text-sm text-ink-600">
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
              Onboard {isSuper ? "master distributor" : "distributor"}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading ? (
          <>
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
          </>
        ) : (
          <>
            <StatCard
              label={isSuper ? "Master Distributors" : "Distributors"}
              value={`${children.length}`}
              icon={Network}
              accent="brand"
            />
            <StatCard
              label="Retailers (network)"
              value={`${totalRetailers.toLocaleString("en-IN")}`}
              icon={Users}
              accent="violet"
            />
            <StatCard
              label="Override Earnings (MTD)"
              value={formatINR(0)}
              icon={IndianRupee}
              accent="emerald"
            />
            <StatCard
              label="Network Turnover (MTD)"
              value={formatINR(mtdTurnover)}
              icon={TrendingUp}
              accent="accent"
            />
          </>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-ink-100 bg-white p-5 lg:col-span-2">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-ink-500">
                Network turnover · last 14 days
              </p>
              <p className="mt-1 font-display text-2xl font-bold text-ink-900">
                {formatINR(mtdTurnover)}
              </p>
            </div>
          </div>
          <div className="mt-4">
            <Sparkline
              values={Array.from({ length: 14 }, () => 0)}
              color="#f97606"
              height={80}
            />
          </div>
          {!loading && mtdTurnover === 0 && (
            <p className="mt-2 text-xs text-ink-500">
              No network turnover yet — figures update as live transactions clear.
            </p>
          )}
        </div>
        <div className="rounded-2xl border border-ink-100 bg-white p-5">
          <div className="flex items-center gap-2 text-brand-700">
            <Globe className="h-4 w-4" />
            <p className="text-xs font-bold uppercase tracking-widest">
              White-label portal
            </p>
          </div>
          <p className="mt-3 font-display text-lg font-semibold text-ink-900">
            {domain ?? "Not configured"}
          </p>
          <p className="mt-1 text-sm text-ink-600">
            {domain
              ? "Manage co-branded portal settings for your downline."
              : "Set a custom domain or subdomain for your distributors."}
          </p>
          <Link
            href="/dashboard/whitelabel"
            className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline"
          >
            {domain ? "Manage branding" : "Set up branding"}{" "}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white">
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
          <div>
            <h3 className="font-display text-base font-semibold text-ink-900">
              My {childLabel}
            </h3>
            <p className="text-xs text-ink-500">
              Direct child {childLabel} with live wallet &amp; turnover
            </p>
          </div>
          <Link
            href="/dashboard/network"
            className="text-xs font-semibold text-brand-700 hover:underline"
          >
            View tree
          </Link>
        </div>
        {children.length === 0 && !loading ? (
          <div className="px-5 py-12 text-center text-sm text-ink-500">
            No {childLabel} yet. Onboard your first partner to build the network.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-ink-50/60 text-left text-xs uppercase tracking-wider text-ink-500">
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
            <tbody className="divide-y divide-ink-100 text-ink-800">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-sm text-ink-500">
                    Loading network…
                  </td>
                </tr>
              ) : (
                children.map((d) => (
                  <tr key={d.id} className="hover:bg-ink-50/40">
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
                    <td className="px-5 py-3 text-right font-semibold text-emerald-700">
                      {formatINR(d.monthlyTurnover)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
