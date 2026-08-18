"use client";

/**
 * Commission Distribution report — what the company is PAYING OUT to the
 * network (DT/MD/SD) per transaction, funded from the Revenue Wallet, with the
 * 2% TDS withheld to the TDS liability ledger. Companion to the Company
 * Earnings report (which shows what the company earns).
 */

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { StatSkeleton } from "@/components/ui/Skeleton";
import { PageSpinner } from "@/components/ui/Spinner";
import { formatINR, formatNumber } from "@/lib/utils";
import { RefreshCw, Download, HandCoins, Landmark, Banknote } from "lucide-react";
import { downloadCSV, downloadPDF, downloadZIP, type ReportColumn } from "@/lib/reports";
import {
  StatTile,
  FilterBar,
  FilterField,
  SectionTitle,
} from "@/components/dashboard/ui";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";

type TierRow = {
  tier: string;
  gross: number;
  tds: number;
  net: number;
  creditCount: number;
};

type DailyRow = {
  date: string;
  grossCommission: number;
  tdsCollected: number;
  netCommission: number;
};

type RevenueData = {
  from: string;
  to: string;
  byTier: TierRow[];
  byDay: DailyRow[];
  totals: {
    grossCommission: number;
    tdsCollected: number;
    netCommission: number;
  };
};

const inputCls =
  "rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

const TIER_LABELS: Record<string, string> = {
  DISTRIBUTOR: "Distributor (DT)",
  MASTER: "Master Distributor (MD)",
  SUPER: "Super Distributor (SD)",
  RETAILER: "Retailer",
  DIRECT: "Direct",
};

function todayIST(): string {
  const d = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export default function CommissionReportPage() {
  const [data, setData] = useState<RevenueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState(todayIST);
  const [to, setTo] = useState(todayIST);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      if (from) p.set("from", from);
      if (to) p.set("to", to);
      const res = await fetch(`/api/admin/reports/revenue?${p}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "Failed to load report");
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tierColumns: Column<TierRow>[] = [
    { key: "tier", header: "Tier", render: (r) => <Badge variant="default">{TIER_LABELS[r.tier] ?? r.tier}</Badge> },
    { key: "creditCount", header: "Payouts", render: (r) => <span>{formatNumber(r.creditCount)}</span> },
    { key: "gross", header: "Gross", render: (r) => <span className="font-semibold">{formatINR(r.gross)}</span> },
    { key: "tds", header: "TDS (2%)", render: (r) => <span className="text-ink-500">{formatINR(r.tds)}</span> },
    { key: "net", header: "Net Paid", render: (r) => <span className="font-bold text-emerald-600">{formatINR(r.net)}</span> },
  ];

  const dailyColumns: Column<DailyRow>[] = [
    { key: "date", header: "Date", render: (r) => <span className="font-medium">{r.date}</span> },
    { key: "grossCommission", header: "Gross", render: (r) => <span>{formatINR(r.grossCommission)}</span> },
    { key: "tdsCollected", header: "TDS", render: (r) => <span className="text-ink-500">{formatINR(r.tdsCollected)}</span> },
    { key: "netCommission", header: "Net Paid", render: (r) => <span className="font-semibold text-emerald-600">{formatINR(r.netCommission)}</span> },
  ];

  const csvTierCols: ReportColumn<TierRow>[] = [
    { key: "tier", header: "Tier" },
    { key: "creditCount", header: "Payouts", format: "int" },
    { key: "gross", header: "Gross Commission", format: "money" },
    { key: "tds", header: "TDS (2%)", format: "money" },
    { key: "net", header: "Net Paid", format: "money" },
  ];

  return (
    <div className="space-y-6">
      <Reveal distance={14} duration={0.4}>
        <PageHeader
          title="Commission Distribution Report"
          description="What the company distributes to the network (DT/MD/SD) per transaction — funded from the Revenue Wallet, net of 2% TDS."
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
        {data && (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => downloadCSV(`commission-report-${data.from}-to-${data.to}`, data.byTier, csvTierCols)}
            >
              <Download className="mr-2 h-4 w-4" /> CSV
            </Button>
            <Button
              variant="outline"
              onClick={() => downloadPDF("Commission Report", data.byTier, csvTierCols, { subtitle: `${data.from} to ${data.to}` })}
            >
              <Download className="mr-2 h-4 w-4" /> PDF
            </Button>
            <Button
              variant="outline"
              onClick={() => downloadZIP(`commission-report-${data.from}-to-${data.to}`, data.byTier, csvTierCols)}
            >
              <Download className="mr-2 h-4 w-4" /> ZIP
            </Button>
          </div>
        )}
      </FilterBar>

      {error && <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</div>}

      {loading && !data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <StatSkeleton key={i} />
            ))}
          </div>
          <PageSpinner label="Loading commission report…" />
        </div>
      )}

      {data && (
        <>
          <Stagger stagger={0.05} className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <StaggerItem distance={14} duration={0.35}>
              <StatTile
                label="Gross Commission"
                countTo={data.totals.grossCommission}
                prefix="₹"
                decimals={2}
                icon={HandCoins}
                tone="brand"
              />
            </StaggerItem>
            <StaggerItem distance={14} duration={0.35}>
              <StatTile
                label="TDS Withheld (2%)"
                countTo={data.totals.tdsCollected}
                prefix="₹"
                decimals={2}
                icon={Landmark}
                tone="ink"
              />
            </StaggerItem>
            <StaggerItem distance={14} duration={0.35}>
              <StatTile
                label="Net Distributed"
                countTo={data.totals.netCommission}
                prefix="₹"
                decimals={2}
                icon={Banknote}
                tone="emerald"
              />
            </StaggerItem>
          </Stagger>

          <Reveal distance={16} duration={0.45}>
            <SectionTitle title="Commission by tier" />
            <DataTable columns={tierColumns} data={data.byTier} loading={loading} />
          </Reveal>

          {data.byDay.length > 0 && (
            <Reveal distance={16} duration={0.45}>
              <SectionTitle title="Daily commission distributed" />
              <DataTable columns={dailyColumns} data={data.byDay} loading={loading} />
            </Reveal>
          )}
        </>
      )}
    </div>
  );
}
