"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { StatSkeleton } from "@/components/ui/Skeleton";
import { PageSpinner } from "@/components/ui/Spinner";
import { formatINR, formatNumber } from "@/lib/utils";
import {
  RefreshCw,
  Download,
  ArrowLeftRight,
  CheckCircle2,
  XCircle,
  Gauge,
  IndianRupee,
} from "lucide-react";
import {
  Panel,
  StatTile,
  FilterBar,
  FilterField,
  SectionTitle,
} from "@/components/dashboard/ui";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";

type ServiceRow = {
  service: string;
  total: number;
  success: number;
  failed: number;
  successRate: number;
  volume: number;
  fees: number;
  commission: number;
  gst: number;
};

type TopUser = {
  user: { id: string; name: string; email: string; role: string; shopName: string | null };
  txns: number;
  volume: number;
  commission: number;
};

type Analytics = {
  range: { from: string; to: string };
  totals: { transactions: number; success: number; failed: number; volume: number; successRate: number };
  daily: Array<{ day: string; count: number; volume: number }>;
  services: ServiceRow[];
  topUsers: TopUser[];
};

const inputCls =
  "rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

export default function AnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const params = useCallback(() => {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    return p;
  }, [from, to]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/analytics?${params()}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "Failed to load analytics");
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const maxVolume = Math.max(1, ...(data?.daily ?? []).map((d) => d.volume));

  const serviceColumns: Column<ServiceRow>[] = [
    {
      key: "service",
      header: "Service",
      render: (r) => <span className="font-semibold">{r.service.replace(/_/g, " ")}</span>,
    },
    { key: "total", header: "Txns", render: (r) => <span>{formatNumber(r.total)}</span> },
    {
      key: "rate",
      header: "Success rate",
      render: (r) => (
        <Badge variant={r.successRate >= 95 ? "success" : r.successRate >= 80 ? "warning" : "danger"}>
          {r.successRate}%
        </Badge>
      ),
    },
    { key: "volume", header: "Volume", render: (r) => <span className="font-semibold">{formatINR(r.volume)}</span> },
    { key: "fees", header: "Fees earned", render: (r) => <span>{formatINR(r.fees)}</span> },
    { key: "commission", header: "Commission paid", render: (r) => <span>{formatINR(r.commission)}</span> },
    { key: "gst", header: "GST", render: (r) => <span>{r.gst > 0 ? formatINR(r.gst) : "—"}</span> },
  ];

  const topUserColumns: Column<TopUser>[] = [
    {
      key: "user",
      header: "User",
      render: (r) => (
        <div>
          <p className="font-medium text-ink-900">{r.user.name}</p>
          <p className="text-xs text-ink-400">
            {r.user.shopName ? `${r.user.shopName} · ` : ""}
            {r.user.role.toLowerCase().replace(/_/g, " ")}
          </p>
        </div>
      ),
    },
    { key: "txns", header: "Txns", render: (r) => <span>{formatNumber(r.txns)}</span> },
    { key: "volume", header: "Volume", render: (r) => <span className="font-semibold">{formatINR(r.volume)}</span> },
    { key: "commission", header: "Commission earned", render: (r) => <span>{formatINR(r.commission)}</span> },
  ];

  return (
    <div className="space-y-6">
      <Reveal distance={14} duration={0.4}>
        <PageHeader
          title="Business Analytics"
          description="Service-wise transaction performance, daily volume trend, and top performers — read-only reporting."
        />
      </Reveal>

      <FilterBar>
        <FilterField label="From">
          <input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} />
        </FilterField>
        <FilterField label="To">
          <input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} />
        </FilterField>
        <Button onClick={load} isLoading={loading}>
          <RefreshCw className="mr-2 h-4 w-4" /> Apply
        </Button>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => window.open(`/api/admin/analytics?${params()}&format=csv`, "_blank")}
          >
            <Download className="mr-2 h-4 w-4" /> CSV
          </Button>
          <Button
            variant="outline"
            onClick={() => window.open(`/api/admin/analytics?${params()}&format=zip`, "_blank")}
          >
            <Download className="mr-2 h-4 w-4" /> ZIP
          </Button>
        </div>
      </FilterBar>

      {error && (
        <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</div>
      )}

      {loading && !data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <StatSkeleton key={i} />
            ))}
          </div>
          <PageSpinner label="Loading analytics…" />
        </div>
      )}

      {data && (
        <>
          <Stagger stagger={0.05} className="grid grid-cols-2 gap-4 md:grid-cols-5">
            <StaggerItem distance={14} duration={0.35}>
              <StatTile
                label="Transactions"
                countTo={data.totals.transactions}
                icon={ArrowLeftRight}
                tone="brand"
              />
            </StaggerItem>
            <StaggerItem distance={14} duration={0.35}>
              <StatTile
                label="Successful"
                countTo={data.totals.success}
                icon={CheckCircle2}
                tone="emerald"
              />
            </StaggerItem>
            <StaggerItem distance={14} duration={0.35}>
              <StatTile
                label="Failed"
                countTo={data.totals.failed}
                icon={XCircle}
                tone={data.totals.failed > 0 ? "rose" : "ink"}
              />
            </StaggerItem>
            <StaggerItem distance={14} duration={0.35}>
              <StatTile
                label="Success rate"
                value={`${data.totals.successRate}%`}
                icon={Gauge}
                tone={data.totals.successRate >= 95 ? "emerald" : "amber"}
              />
            </StaggerItem>
            <StaggerItem distance={14} duration={0.35}>
              <StatTile
                label="Volume (success)"
                countTo={data.totals.volume}
                prefix="₹"
                decimals={2}
                icon={IndianRupee}
                tone="violet"
              />
            </StaggerItem>
          </Stagger>

          {/* Daily volume trend — CSS bars */}
          <Reveal distance={16} duration={0.45}>
          <Panel>
            <SectionTitle title="Daily success volume" />
            {data.daily.length === 0 ? (
              <p className="text-sm text-ink-400">No successful transactions in this range.</p>
            ) : (
              <div className="flex h-40 items-end gap-1 overflow-x-auto">
                {data.daily.map((d) => (
                  <div key={d.day} className="group relative flex min-w-[14px] flex-1 flex-col items-center justify-end">
                    <div
                      className="w-full rounded-t bg-brand-500 transition group-hover:bg-brand-600"
                      style={{ height: `${Math.max(3, (d.volume / maxVolume) * 100)}%` }}
                    />
                    <div className="pointer-events-none absolute bottom-full mb-1 hidden whitespace-nowrap rounded-lg bg-ink-900 px-2 py-1 text-[10px] text-white group-hover:block">
                      {d.day} · {formatINR(d.volume)} · {d.count} txns
                    </div>
                  </div>
                ))}
              </div>
            )}
            {data.daily.length > 0 && (
              <div className="mt-2 flex justify-between text-[10px] text-ink-400">
                <span>{data.daily[0].day}</span>
                <span>{data.daily[data.daily.length - 1].day}</span>
              </div>
            )}
          </Panel>
          </Reveal>

          <Reveal distance={16} duration={0.45}>
            <SectionTitle title="Service-wise report" />
            <DataTable
              columns={serviceColumns}
              data={data.services}
              loading={loading}
            />
          </Reveal>

          <Reveal distance={16} duration={0.45}>
            <SectionTitle title="Top 10 users by volume" />
            <DataTable
              columns={topUserColumns}
              data={data.topUsers}
              loading={loading}
            />
          </Reveal>
        </>
      )}
    </div>
  );
}
