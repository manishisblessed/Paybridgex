"use client";

/**
 * Admin per-transaction EARNINGS report — the platform-owner view of what the
 * company earns on every commission-bearing capture across all acquiring rails
 * (POS / PG / QR / UPI), and how the MDR margin is distributed to the network
 * chain (DT / MD / SD). Net earning = company margin − commission distributed.
 *
 * Backed by POST /api/admin/earnings-report (src/lib/admin/earningsReport.ts).
 */

import { useState, useCallback, useMemo } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  ArrowLeftRight,
  IndianRupee,
  Scissors,
  Banknote,
  HandCoins,
  Landmark,
  TrendingUp,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Users,
  Receipt,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { StatCard } from "@/components/dashboard/StatCard";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatINR } from "@/lib/utils";
import { type ReportColumn } from "@/lib/reports";
import { ReportActions } from "@/components/dashboard/ReportActions";

// ── API contract (mirrors src/lib/admin/earningsReport.ts) ──

type Rail = "POS" | "PG" | "QR" | "UPI" | "OTHER";

type Retailer = {
  id: string;
  name: string;
  shopName: string | null;
  userCode: string | null;
  role: string;
};

type Recipient = { name: string; userCode: string | null; gross: number; tds: number };

type ReportRow = {
  transactionId: string;
  refId: string;
  rail: Rail;
  txnTime: string;
  retailer: Retailer | null;
  amount: number;
  mdrAmount: number | null;
  netSettled: number | null;
  settlementStatus: string | null;
  uplineDepth: number;
  companyMargin: number;
  commDistributor: number;
  commMaster: number;
  commSuper: number;
  totalCommission: number;
  tdsDistributor: number;
  tdsMaster: number;
  tdsSuper: number;
  totalTds: number;
  platformEarning: number;
  distributor: Recipient | null;
  master: Recipient | null;
  superDistributor: Recipient | null;
};

type RollupRow = {
  userId: string;
  name: string;
  shopName: string | null;
  userCode: string | null;
  role: string;
  txnCount: number;
  amount: number;
  companyMargin: number;
  totalCommission: number;
  platformEarning: number;
};

type Summary = {
  totalTransactions: number;
  totalVolume: number;
  totalMdr: number;
  totalSettled: number;
  totalMargin: number;
  totalDistributor: number;
  totalMaster: number;
  totalSuper: number;
  totalCommission: number;
  totalTds: number;
  totalPlatformEarning: number;
};

type ReportResponse = {
  rows: ReportRow[];
  rollup: RollupRow[];
  summary: Summary;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasPrev: boolean;
    hasNext: boolean;
  };
  truncated: boolean;
};

const ROLE_LABELS: Record<string, string> = {
  SUPER_DISTRIBUTOR: "Super Distributor",
  MASTER_DISTRIBUTOR: "Master Distributor",
  DISTRIBUTOR: "Distributor",
  RETAILER: "Retailer",
};

const RAIL_VARIANT: Record<Rail, "brand" | "accent" | "warning" | "success" | "default"> = {
  POS: "brand",
  PG: "accent",
  QR: "warning",
  UPI: "success",
  OTHER: "default",
};

async function postFetcher<T>([url, body]: readonly [string, unknown]): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json: { error?: string } = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(r.ok ? "Invalid response from server" : `Request failed (${r.status})`);
  }
  if (!r.ok) throw new Error(typeof json?.error === "string" ? json.error : "Request failed");
  return json as T;
}

function defaultDateRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function merchantCell(r: { retailer: Retailer | null }) {
  if (!r.retailer) return <span className="text-xs text-ink-400">—</span>;
  return (
    <div className="flex flex-col">
      <span className="max-w-[150px] truncate text-xs font-semibold text-ink-900">
        {r.retailer.shopName || r.retailer.name}
      </span>
      <span className="text-[11px] text-ink-500">
        {r.retailer.userCode ? <span className="font-medium text-brand-600">{r.retailer.userCode}</span> : null}
        {r.retailer.userCode ? " · " : ""}
        {ROLE_LABELS[r.retailer.role] ?? r.retailer.role}
      </span>
    </div>
  );
}

function commissionCell(recipient: Recipient | null, hasUpline: boolean) {
  if (recipient && recipient.gross > 0) {
    return (
      <div className="flex flex-col items-end">
        <span className="font-semibold text-ink-900">{formatINR(recipient.gross)}</span>
        <span className="max-w-[110px] truncate text-[10px] text-ink-500">
          {recipient.userCode ?? recipient.name}
        </span>
      </div>
    );
  }
  // Upline exists at this tier but earned nothing (scheme pays ₹0 here).
  if (hasUpline) return <span className="text-xs text-ink-400">{formatINR(0)}</span>;
  // No ancestor at this tier — nobody to pay; the platform retains this share.
  return (
    <span className="text-xs text-ink-300" title="No upline at this tier">
      —
    </span>
  );
}

function settlementBadge(status: string | null) {
  if (!status) return <span className="text-xs text-ink-300">—</span>;
  if (status === "SETTLED") return <Badge variant="success">Settled</Badge>;
  if (status === "FAILED") return <Badge variant="danger">Failed</Badge>;
  return <Badge variant="warning">Pending · T+1</Badge>;
}

type View = "transactions" | "rollup";

export default function AdminEarningsPage() {
  const defaults = defaultDateRange();
  const [dateFrom, setDateFrom] = useState(defaults.from);
  const [dateTo, setDateTo] = useState(defaults.to);
  const [railFilter, setRailFilter] = useState<"" | "POS" | "PG" | "QR" | "UPI">("");
  const [retailerId, setRetailerId] = useState<string | null>(null);
  const [retailerLabel, setRetailerLabel] = useState<string | null>(null);
  const [view, setView] = useState<View>("transactions");
  const [page, setPage] = useState(1);

  const body = useMemo(
    () => ({
      date_from: `${dateFrom}T00:00:00.000+05:30`,
      date_to: `${dateTo}T23:59:59.999+05:30`,
      rail: railFilter || null,
      retailer_id: retailerId,
      page,
      page_size: 50,
    }),
    [dateFrom, dateTo, railFilter, retailerId, page]
  );

  const { data, error, isLoading, mutate } = useSWR<ReportResponse>(
    ["/api/admin/earnings-report", body],
    postFetcher,
    { revalidateOnFocus: false, keepPreviousData: true }
  );

  const summary = data?.summary;
  const pagination = data?.pagination;
  const rows = data?.rows ?? [];
  const rollup = data?.rollup ?? [];

  const drillToUser = useCallback((r: RollupRow) => {
    setRetailerId(r.userId);
    setRetailerLabel(r.shopName || r.name);
    setView("transactions");
    setPage(1);
  }, []);

  const clearDrill = useCallback(() => {
    setRetailerId(null);
    setRetailerLabel(null);
    setPage(1);
  }, []);

  const fetchAllRows = useCallback(async (): Promise<ReportRow[]> => {
    const res = await fetch("/api/admin/earnings-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, export: true }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast.error(typeof d.error === "string" ? d.error : "Failed to build report");
      return rows;
    }
    const d = await res.json();
    if (d.truncated) {
      toast.warning(
        `Report capped at ${Number(d.returned).toLocaleString("en-IN")} rows — narrow the date range for the rest.`
      );
    }
    return (d.rows as ReportRow[]) ?? [];
  }, [body, rows]);

  const exportCols: ReportColumn<ReportRow>[] = [
    { key: "txnTime", header: "Time", render: (r) => new Date(r.txnTime).toLocaleString("en-IN") },
    { key: "rail", header: "Rail", render: (r) => r.rail },
    { key: "refId", header: "Ref", render: (r) => r.refId },
    { key: "retailer", header: "Merchant", render: (r) => r.retailer?.shopName || r.retailer?.name || "" },
    { key: "userCode", header: "Merchant Code", render: (r) => r.retailer?.userCode ?? "" },
    { key: "amount", header: "Amount (INR)", format: "money", render: (r) => r.amount.toFixed(2) },
    { key: "mdrAmount", header: "MDR (INR)", format: "money", render: (r) => (r.mdrAmount != null ? r.mdrAmount.toFixed(2) : "") },
    { key: "netSettled", header: "Settled (INR)", format: "money", render: (r) => (r.netSettled != null ? r.netSettled.toFixed(2) : "") },
    { key: "settlementStatus", header: "Settlement", render: (r) => r.settlementStatus ?? "" },
    { key: "companyMargin", header: "Company Margin (INR)", format: "money", render: (r) => r.companyMargin.toFixed(2) },
    { key: "commDistributor", header: "DT Commission (INR)", format: "money", render: (r) => r.commDistributor.toFixed(2) },
    { key: "commMaster", header: "MD Commission (INR)", format: "money", render: (r) => r.commMaster.toFixed(2) },
    { key: "commSuper", header: "SD Commission (INR)", format: "money", render: (r) => r.commSuper.toFixed(2) },
    { key: "totalCommission", header: "Total Commission (INR)", format: "money", render: (r) => r.totalCommission.toFixed(2) },
    { key: "tdsDistributor", header: "DT TDS (INR)", format: "money", render: (r) => r.tdsDistributor.toFixed(2) },
    { key: "tdsMaster", header: "MD TDS (INR)", format: "money", render: (r) => r.tdsMaster.toFixed(2) },
    { key: "tdsSuper", header: "SD TDS (INR)", format: "money", render: (r) => r.tdsSuper.toFixed(2) },
    { key: "totalTds", header: "Total TDS 2% (INR)", format: "money", render: (r) => r.totalTds.toFixed(2) },
    { key: "platformEarning", header: "Platform Earning (INR)", format: "money", render: (r) => r.platformEarning.toFixed(2) },
  ];

  const txnCols: Column<ReportRow>[] = [
    { key: "txnTime", header: "Time", render: (r) => <span className="text-xs">{fmtTime(r.txnTime)}</span> },
    { key: "retailer", header: "Merchant", render: merchantCell },
    { key: "rail", header: "Rail", render: (r) => <Badge variant={RAIL_VARIANT[r.rail]}>{r.rail}</Badge> },
    { key: "amount", header: "Amount", align: "right", render: (r) => <span className="font-semibold text-ink-900">{formatINR(r.amount)}</span> },
    { key: "mdrAmount", header: "MDR", align: "right", render: (r) => (r.mdrAmount != null ? <span className="text-rose-600">−{formatINR(r.mdrAmount)}</span> : <span className="text-xs text-ink-300">—</span>) },
    { key: "netSettled", header: "Settled", align: "right", render: (r) => (r.netSettled != null ? <span className="font-semibold text-ink-900">{formatINR(r.netSettled)}</span> : <span className="text-xs text-ink-300">—</span>) },
    { key: "companyMargin", header: "Margin", align: "right", render: (r) => <span className="text-ink-700">{formatINR(r.companyMargin)}</span> },
    { key: "commDistributor", header: "DT", align: "right", render: (r) => commissionCell(r.distributor, r.uplineDepth >= 1) },
    { key: "commMaster", header: "MD", align: "right", render: (r) => commissionCell(r.master, r.uplineDepth >= 2) },
    { key: "commSuper", header: "SD", align: "right", render: (r) => commissionCell(r.superDistributor, r.uplineDepth >= 3) },
    { key: "totalTds", header: "TDS 2%", align: "right", render: (r) => (r.totalTds > 0 ? <span className="text-amber-700">−{formatINR(r.totalTds)}</span> : <span className="text-xs text-ink-300">—</span>) },
    { key: "platformEarning", header: "Platform Earning", align: "right", render: (r) => <span className="font-semibold text-emerald-700">{formatINR(r.platformEarning)}</span> },
    { key: "settlementStatus", header: "Status", render: (r) => settlementBadge(r.settlementStatus) },
  ];

  const rollupCols: Column<RollupRow>[] = [
    {
      key: "name",
      header: "Merchant",
      render: (r) => (
        <div className="flex flex-col">
          <span className="max-w-[180px] truncate text-xs font-semibold text-ink-900">{r.shopName || r.name}</span>
          <span className="text-[11px] text-ink-500">
            {r.userCode ? <span className="font-medium text-brand-600">{r.userCode}</span> : null}
            {r.userCode ? " · " : ""}
            {ROLE_LABELS[r.role] ?? r.role}
          </span>
        </div>
      ),
    },
    { key: "txnCount", header: "Txns", align: "right", render: (r) => <span className="font-semibold">{r.txnCount.toLocaleString("en-IN")}</span> },
    { key: "amount", header: "Volume", align: "right", render: (r) => <span className="font-semibold text-ink-900">{formatINR(r.amount)}</span> },
    { key: "companyMargin", header: "Margin", align: "right", render: (r) => <span className="text-ink-700">{formatINR(r.companyMargin)}</span> },
    { key: "totalCommission", header: "Commission", align: "right", render: (r) => <span className="text-rose-600">−{formatINR(r.totalCommission)}</span> },
    { key: "platformEarning", header: "Platform Earning", align: "right", render: (r) => <span className="font-semibold text-emerald-700">{formatINR(r.platformEarning)}</span> },
    {
      key: "drill",
      header: "",
      align: "right",
      render: (r) => (
        <button
          onClick={() => drillToUser(r)}
          className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand-700 transition-colors hover:bg-brand-100"
        >
          <Receipt className="h-3 w-3" /> View txns
        </button>
      ),
    },
  ];

  const reportSubtitle =
    `${dateFrom} to ${dateTo}` +
    (railFilter ? ` · ${railFilter}` : "") +
    (retailerLabel ? ` · ${retailerLabel}` : "");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Platform Earnings"
        title="Per-Transaction Earnings"
        description="What the company earns on every capture across all rails (POS / PG / QR / UPI), and the commission distributed to DT / MD / SD per transaction. Net earning = company MDR margin − commission distributed."
      />

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <StatCard label="Transactions" value={summary ? summary.totalTransactions.toLocaleString("en-IN") : "..."} icon={ArrowLeftRight} accent="brand" />
        <StatCard label="Total Volume" value={summary ? formatINR(summary.totalVolume) : "..."} icon={IndianRupee} accent="violet" />
        <StatCard label="MDR Collected" value={summary ? formatINR(summary.totalMdr) : "..."} icon={Scissors} accent="accent" />
        <StatCard label="Settled to Merchants" value={summary ? formatINR(summary.totalSettled) : "..."} icon={Banknote} accent="violet" />
        <StatCard label="Commission Distributed" value={summary ? formatINR(summary.totalCommission) : "..."} icon={HandCoins} accent="brand" />
        <StatCard label="TDS Withheld (2%)" value={summary ? formatINR(summary.totalTds) : "..."} icon={Landmark} accent="accent" />
        <StatCard label="Platform Net Earning" value={summary ? formatINR(summary.totalPlatformEarning) : "..."} icon={TrendingUp} accent="emerald" />
      </div>

      {/* Filters */}
      <div className="rounded-2xl border border-ink-100 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-500">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              className="rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-500">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              className="rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-500">Rail</label>
            <select
              value={railFilter}
              onChange={(e) => { setRailFilter(e.target.value as typeof railFilter); setPage(1); }}
              className="rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
            >
              <option value="">All rails</option>
              <option value="POS">POS</option>
              <option value="PG">Payment Gateway</option>
              <option value="QR">QR</option>
              <option value="UPI">UPI Collect</option>
            </select>
          </div>
          <Button variant="outline" size="sm" onClick={() => mutate()} title="Refresh">
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>

          <div className="ml-auto flex flex-wrap gap-2">
            <ReportActions<ReportRow>
              filename={`platform-earnings-${dateFrom}-to-${dateTo}`}
              title="Platform Earnings Report"
              subtitle={reportSubtitle}
              columns={exportCols}
              rows={rows}
              fetchRows={fetchAllRows}
            />
          </div>
        </div>

        {retailerLabel && (
          <div className="mt-3 flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
              Showing: {retailerLabel}
              <button onClick={clearDrill} className="rounded-full hover:bg-brand-100" aria-label="Clear filter">
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          </div>
        )}
      </div>

      {/* View toggle */}
      <div className="flex gap-1 rounded-xl border border-ink-100 bg-ink-50/60 p-1">
        {([
          { id: "transactions", label: "Per Transaction", icon: Receipt },
          { id: "rollup", label: "By Merchant", icon: Users },
        ] as const).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setView(id)}
            className={
              view === id
                ? "flex-1 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-ink-900 shadow-sm"
                : "flex-1 rounded-lg px-4 py-2 text-sm font-semibold text-ink-500 transition-colors hover:text-ink-700"
            }
          >
            <span className="flex items-center justify-center gap-2"><Icon className="h-4 w-4" /> {label}</span>
          </button>
        ))}
      </div>

      {data?.truncated && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Showing the most recent 20,000 transactions for this range. Narrow the date range for exact full-period totals.
        </div>
      )}

      {error ? (
        <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error instanceof Error ? error.message : "Failed to load the earnings report."}
        </div>
      ) : view === "transactions" ? (
        <>
          <DataTable
            title="Platform earnings — per transaction"
            description={
              pagination
                ? `${pagination.total.toLocaleString("en-IN")} transaction${pagination.total === 1 ? "" : "s"} · page ${pagination.page} of ${pagination.totalPages}`
                : isLoading
                  ? "Loading..."
                  : "No data yet"
            }
            columns={txnCols}
            data={rows}
            loading={isLoading}
            empty="No commission-bearing transactions for the selected filters."
          />
          {pagination && pagination.totalPages > 1 && (
            <Paginator
              page={pagination.page}
              totalPages={pagination.totalPages}
              hasPrev={pagination.hasPrev}
              hasNext={pagination.hasNext}
              onPrev={() => setPage((p) => Math.max(1, p - 1))}
              onNext={() => setPage((p) => p + 1)}
            />
          )}
        </>
      ) : (
        <DataTable
          title="Earnings rollup — by merchant"
          description={
            rollup.length
              ? `${rollup.length} merchant${rollup.length === 1 ? "" : "s"} with activity in this period`
              : isLoading
                ? "Loading..."
                : "No data yet"
          }
          columns={rollupCols}
          data={rollup}
          loading={isLoading}
          empty="No activity for the selected filters."
        />
      )}
    </div>
  );
}

function Paginator({ page, totalPages, hasPrev, hasNext, onPrev, onNext }: {
  page: number; totalPages: number; hasPrev: boolean; hasNext: boolean; onPrev: () => void; onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-center gap-3">
      <Button variant="outline" size="sm" disabled={!hasPrev} onClick={onPrev}>
        <ChevronLeft className="h-4 w-4" /> Previous
      </Button>
      <span className="text-sm text-ink-600">Page {page} of {totalPages}</span>
      <Button variant="outline" size="sm" disabled={!hasNext} onClick={onNext}>
        Next <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
