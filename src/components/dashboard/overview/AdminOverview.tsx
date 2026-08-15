"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ShieldCheck,
  Users,
  Banknote,
  ServerCog,
  ArrowRight,
  Activity,
  RefreshCw,
} from "lucide-react";
import { StatCard } from "@/components/dashboard/StatCard";
import { StatSkeleton } from "@/components/ui/Skeleton";
import { Stagger, StaggerItem, Reveal } from "@/components/motion";
import { Button } from "@/components/ui/Button";
import type { Session } from "@/lib/auth";
import { formatINR, formatNumber } from "@/lib/utils";
import { CumulativeWalletCard, type CumulativeData, type PartnerFloat } from "./admin/CumulativeWalletCard";
import { RevenueWalletCard } from "./admin/RevenueWalletCard";
import { UserBalancesCard } from "./admin/UserBalancesCard";
import { ProviderWalletsCard } from "./admin/ProviderWalletsCard";
import { DailyUserReportCard } from "./admin/DailyUserReportCard";

type PayoutStats = {
  volumeToday: number;
  countToday: number;
  volumeMonth: number;
  successRate: number | null;
  successCount30: number;
  terminalCount30: number;
  inflight: number;
  daily: number[];
};

type StatsData = {
  activeUsers: number;
  totalUsers: number;
  pendingKyc: number;
  settledToday: number;
  txnsToday: number;
  monthlyGmv: number;
  dailyGmv: number[];
  serviceHealth: { service: string; live: boolean; provider: string }[];
  auditEvents: { id: string; actor: string; action: string; target: string; severity: string; ts: string }[];
  vendorBalanceTotal?: number;
  payout?: PayoutStats;
};

export function AdminOverview({ session }: { session: Session }) {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [liability, setLiability] = useState<CumulativeData | null>(null);
  const [liabilityLoading, setLiabilityLoading] = useState(true);
  const [providers, setProviders] = useState<PartnerFloat[] | null>(null);
  const [providersError, setProvidersError] = useState<string | null>(null);
  const [providersAsOf, setProvidersAsOf] = useState<Date | null>(null);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [loading, setLoading] = useState(true);

  const loadLiability = useCallback(async () => {
    setLiabilityLoading(true);
    try {
      const r = await fetch("/api/admin/wallet/aggregates?view=cumulative");
      if (r.ok) setLiability(await r.json());
    } catch {
      /* keep last data */
    } finally {
      setLiabilityLoading(false);
    }
  }, []);

  const loadProviders = useCallback(async () => {
    setProvidersLoading(true);
    try {
      const r = await fetch("/api/admin/providers/balances");
      const d = await r.json().catch(() => null);
      if (!r.ok || !Array.isArray(d?.providers)) {
        setProviders([]);
        setProvidersError(d?.error || "Could not load provider balances");
      } else {
        setProviders(d.providers);
        setProvidersError(null);
        setProvidersAsOf(new Date());
      }
    } catch {
      setProviders([]);
      setProvidersError("Could not load provider balances");
    } finally {
      setProvidersLoading(false);
    }
  }, []);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/stats");
      const data = await res.json();
      setStats(data);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
    loadLiability();
    loadProviders();
  }, [loadLiability, loadProviders]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const livePartners = stats?.serviceHealth.filter((s) => s.live).length ?? 0;
  const totalPartners = stats?.serviceHealth.length ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs text-ink-500">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent-500" />
            </span>
            Platform admin · {session.email}
          </p>
          <h1 className="heading-md">Paybridgex Command Centre</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={fetchStats} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Link href="/dashboard/admin/system">
            <Button variant="outline" size="sm">
              <Activity className="h-3.5 w-3.5" />
              Status
            </Button>
          </Link>
          <Link href="/dashboard/admin/kyc">
            <Button size="sm">
              Review KYC ({stats?.pendingKyc ?? 0})
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
      </div>

      <Stagger className="grid gap-3 grid-cols-2 lg:grid-cols-4" stagger={0.04}>
        {loading ? (
          <>
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
          </>
        ) : (
          <>
            <StaggerItem distance={10} duration={0.3}>
              <StatCard
                label="Active Users"
                value={formatNumber(stats?.activeUsers ?? 0)}
                countTo={stats?.activeUsers ?? 0}
                delta={`of ${formatNumber(stats?.totalUsers ?? 0)}`}
                trend="up"
                icon={Users}
                accent="brand"
                href="/dashboard/admin/users"
              />
            </StaggerItem>
            <StaggerItem distance={10} duration={0.3}>
              <StatCard
                label="KYC in Queue"
                value={String(stats?.pendingKyc ?? 0)}
                countTo={stats?.pendingKyc ?? 0}
                delta=""
                trend="down"
                icon={ShieldCheck}
                accent="accent"
                href="/dashboard/admin/kyc"
              />
            </StaggerItem>
            <StaggerItem distance={10} duration={0.3}>
              <StatCard
                label="Settled Today"
                value={formatINR(stats?.settledToday ?? 0)}
                countTo={stats?.settledToday ?? 0}
                prefix="₹"
                decimals={2}
                delta={`${stats?.txnsToday ?? 0} txns`}
                trend="up"
                icon={Banknote}
                accent="emerald"
                href="/dashboard/admin/settlements"
              />
            </StaggerItem>
            <StaggerItem distance={10} duration={0.3}>
              <StatCard
                label="Partners Live"
                value={`${livePartners} / ${totalPartners}`}
                delta=""
                trend="up"
                icon={ServerCog}
                accent="violet"
                href="/dashboard/admin/services"
              />
            </StaggerItem>
          </>
        )}
      </Stagger>

      {/* ── Revenue Wallet (company earnings) — platform owner only ─── */}
      {session.role === "master-admin" && (
        <Reveal distance={12} duration={0.35}>
          <RevenueWalletCard />
        </Reveal>
      )}

      {/* ── Money: cumulative liability + user-wise + provider floats ─── */}
      <Reveal distance={12} duration={0.35}>
        <CumulativeWalletCard
          data={liability}
          partners={providers}
          loading={liabilityLoading}
          onRefresh={() => {
            loadLiability();
            loadProviders();
          }}
          refreshing={liabilityLoading || providersLoading}
        />
      </Reveal>

      <Reveal distance={12} duration={0.35}>
        <UserBalancesCard />
      </Reveal>

      <Reveal distance={12} duration={0.35}>
        <ProviderWalletsCard
          providers={providers}
          errorMessage={providersError}
          loading={providersLoading}
          onRefreshAll={loadProviders}
          refreshing={providersLoading}
          asOf={providersAsOf}
        />
      </Reveal>

      <Reveal distance={12} duration={0.35}>
        <DailyUserReportCard />
      </Reveal>

    </div>
  );
}
