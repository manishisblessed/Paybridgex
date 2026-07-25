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
import { RefreshCw, Download } from "lucide-react";
import { downloadCSV, downloadPDF, downloadZIP, type ReportColumn } from "@/lib/reports";

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

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "muted" }) {
  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">{label}</p>
      <p
        className={`mt-1 text-xl font-bold ${
          tone === "good" ? "text-emerald-600" : tone === "muted" ? "text-ink-500" : "text-ink-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
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
      <PageHeader
        title="Commission Distribution Report"
        description="What the company distributes to the network (DT/MD/SD) per transaction — funded from the Revenue Wallet, net of 2% TDS."
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-ink-500">
              From
              <input type="date" className={`${inputCls} mt-1 block`} value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="text-xs text-ink-500">
              To
              <input type="date" className={`${inputCls} mt-1 block`} value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <Button onClick={load} isLoading={loading}>
              <RefreshCw className="mr-2 h-4 w-4" /> Apply
            </Button>
            {data && (
              <>
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
              </>
            )}
          </div>
        }
      />

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
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <Stat label="Gross Commission" value={formatINR(data.totals.grossCommission)} />
            <Stat label="TDS Withheld (2%)" value={formatINR(data.totals.tdsCollected)} tone="muted" />
            <Stat label="Net Distributed" value={formatINR(data.totals.netCommission)} tone="good" />
          </div>

          <div>
            <p className="mb-3 text-sm font-semibold text-ink-800">Commission by tier</p>
            <DataTable columns={tierColumns} data={data.byTier} loading={loading} />
          </div>

          {data.byDay.length > 0 && (
            <div>
              <p className="mb-3 text-sm font-semibold text-ink-800">Daily commission distributed</p>
              <DataTable columns={dailyColumns} data={data.byDay} loading={loading} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
