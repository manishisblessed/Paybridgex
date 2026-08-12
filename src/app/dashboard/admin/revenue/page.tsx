"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { StatSkeleton } from "@/components/ui/Skeleton";
import { PageSpinner } from "@/components/ui/Spinner";
import { formatINR, formatNumber } from "@/lib/utils";
import { RefreshCw, Download } from "lucide-react";
import { downloadCSV, downloadPDF, downloadZIP, type ReportColumn } from "@/lib/reports";

type ServiceRow = {
  service: string;
  /** Per-product label for BBPS/CC rails (null for other services). */
  product: string | null;
  txnCount: number;
  totalVolume: number;
  totalCharge: number;
  gstCollected: number;
  vendorCost: number;
  grossCommission: number;
  tdsCollected: number;
  netCommission: number;
  platformRevenue: number;
};

type TierRow = {
  tier: string;
  gross: number;
  tds: number;
  net: number;
  creditCount: number;
};

type SettlementLegRow = {
  leg: string;
  settlementType: string | null;
  txnCount: number;
  totalVolume: number;
  margin: number;
  grossCommission: number;
  companyNet: number;
};

type DailyRow = {
  date: string;
  txnCount: number;
  totalVolume: number;
  totalCharge: number;
  gstCollected: number;
  vendorCost: number;
  grossCommission: number;
  tdsCollected: number;
  netCommission: number;
  platformRevenue: number;
};

type RevenueWalletTxn = {
  id: string;
  amount: number;
  direction: "CREDIT" | "DEBIT";
  reason: string;
  balanceAfter: number;
  note: string | null;
  refId: string | null;
  createdAt: string;
};

type RevenueWallet = {
  accountId: string | null;
  accountName: string | null;
  balance: number;
  creditedInRange: number;
  commissionPaidInRange: number;
  recent: RevenueWalletTxn[];
};

type RevenueData = {
  from: string;
  to: string;
  byService: ServiceRow[];
  byTier: TierRow[];
  byDay: DailyRow[];
  posByLeg: SettlementLegRow[];
  qrByLeg: SettlementLegRow[];
  wallet: RevenueWallet;
  totals: {
    txnCount: number;
    totalVolume: number;
    totalCharge: number;
    gstCollected: number;
    vendorCost: number;
    grossCommission: number;
    tdsCollected: number;
    netCommission: number;
    platformRevenue: number;
  };
};

const inputCls =
  "rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">{label}</p>
      <p
        className={`mt-1 text-xl font-bold ${
          tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-rose-600" : "text-ink-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

const TIER_LABELS: Record<string, string> = {
  RETAILER: "Retailer",
  DISTRIBUTOR: "Distributor",
  MASTER: "Master Distributor",
  SUPER: "Super Distributor",
};

function todayIST(): string {
  const d = new Date(Date.now() + (5.5 * 60 * 60 * 1000));
  return d.toISOString().slice(0, 10);
}

export default function RevenuePage() {
  const { data: session, status } = useSession();
  const isMaster = (session?.user as { role?: string } | undefined)?.role === "MASTER_ADMIN";
  const [data, setData] = useState<RevenueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState(todayIST);
  const [to, setTo] = useState(todayIST);

  const buildParams = useCallback(() => {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    return p;
  }, [from, to]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/reports/revenue?${buildParams()}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "Failed to load report");
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [buildParams]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const serviceColumns: Column<ServiceRow>[] = [
    {
      key: "service",
      header: "Service",
      render: (r) => (
        <div className="leading-tight">
          <span className="font-semibold">{r.service.replace(/_/g, " ")}</span>
          {r.product && <div className="text-[11px] font-medium text-brand-600">{r.product}</div>}
        </div>
      ),
    },
    { key: "txnCount", header: "Txns", render: (r) => <span>{formatNumber(r.txnCount)}</span> },
    {
      key: "totalVolume",
      header: "Volume",
      render: (r) => <span className="font-semibold">{formatINR(r.totalVolume)}</span>,
    },
    { key: "totalCharge", header: "Charges", render: (r) => <span>{formatINR(r.totalCharge)}</span> },
    {
      key: "gstCollected",
      header: "GST",
      render: (r) => <span className="text-ink-500">{formatINR(r.gstCollected)}</span>,
    },
    {
      key: "vendorCost",
      header: "Vendor Cost",
      render: (r) =>
        r.vendorCost > 0 ? (
          <span className="text-amber-600">{formatINR(r.vendorCost)}</span>
        ) : (
          <span className="text-ink-300">—</span>
        ),
    },
    {
      key: "grossCommission",
      header: "Gross Commission",
      render: (r) => <span>{formatINR(r.grossCommission)}</span>,
    },
    {
      key: "tdsCollected",
      header: "TDS (2%)",
      render: (r) => <span className="text-ink-500">{formatINR(r.tdsCollected)}</span>,
    },
    {
      key: "netCommission",
      header: "Net Commission",
      render: (r) => <span>{formatINR(r.netCommission)}</span>,
    },
    {
      key: "platformRevenue",
      header: "Platform Revenue",
      render: (r) => (
        <span className={`font-bold ${r.platformRevenue >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
          {formatINR(r.platformRevenue)}
        </span>
      ),
    },
  ];

  const tierColumns: Column<TierRow>[] = [
    {
      key: "tier",
      header: "Tier",
      render: (r) => (
        <Badge variant="default">{TIER_LABELS[r.tier] ?? r.tier}</Badge>
      ),
    },
    { key: "creditCount", header: "Credits", render: (r) => <span>{formatNumber(r.creditCount)}</span> },
    {
      key: "gross",
      header: "Gross",
      render: (r) => <span className="font-semibold">{formatINR(r.gross)}</span>,
    },
    {
      key: "tds",
      header: "TDS Deducted",
      render: (r) => <span className="text-ink-500">{formatINR(r.tds)}</span>,
    },
    {
      key: "net",
      header: "Net Credited",
      render: (r) => <span className="font-bold text-emerald-600">{formatINR(r.net)}</span>,
    },
  ];

  const legColumns: Column<SettlementLegRow>[] = [
    {
      key: "leg",
      header: "Settlement leg",
      render: (r) => (
        <Badge variant={r.settlementType === "T0" ? "brand" : r.settlementType === "T1" ? "default" : "warning"}>
          {r.leg}
        </Badge>
      ),
    },
    { key: "txnCount", header: "Txns", render: (r) => <span>{formatNumber(r.txnCount)}</span> },
    {
      key: "totalVolume",
      header: "Volume",
      render: (r) => <span className="font-semibold">{formatINR(r.totalVolume)}</span>,
    },
    {
      key: "margin",
      header: "MDR Margin",
      render: (r) => <span className="font-semibold text-emerald-600">{formatINR(r.margin)}</span>,
    },
    {
      key: "grossCommission",
      header: "Chain Commission",
      render: (r) => <span className="text-ink-500">{formatINR(r.grossCommission)}</span>,
    },
    {
      key: "companyNet",
      header: "Company Net",
      render: (r) => (
        <span className={`font-bold ${r.companyNet >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
          {formatINR(r.companyNet)}
        </span>
      ),
    },
  ];

  const dailyColumns: Column<DailyRow>[] = [
    { key: "date", header: "Date", render: (r) => <span className="font-medium">{r.date}</span> },
    { key: "txnCount", header: "Txns", render: (r) => <span>{formatNumber(r.txnCount)}</span> },
    {
      key: "totalVolume",
      header: "Volume",
      render: (r) => <span className="font-semibold">{formatINR(r.totalVolume)}</span>,
    },
    { key: "totalCharge", header: "Charges", render: (r) => <span>{formatINR(r.totalCharge)}</span> },
    { key: "grossCommission", header: "Gross Comm.", render: (r) => <span>{formatINR(r.grossCommission)}</span> },
    {
      key: "tdsCollected",
      header: "TDS",
      render: (r) => <span className="text-ink-500">{formatINR(r.tdsCollected)}</span>,
    },
    { key: "netCommission", header: "Net Comm.", render: (r) => <span>{formatINR(r.netCommission)}</span> },
    {
      key: "platformRevenue",
      header: "Platform Revenue",
      render: (r) => (
        <span className={`font-bold ${r.platformRevenue >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
          {formatINR(r.platformRevenue)}
        </span>
      ),
    },
  ];

  const walletColumns: Column<RevenueWalletTxn>[] = [
    {
      key: "createdAt",
      header: "Date",
      render: (r) => (
        <span className="whitespace-nowrap text-xs text-ink-500">
          {new Date(r.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
        </span>
      ),
    },
    {
      key: "note",
      header: "Description",
      render: (r) => <span className="text-ink-700">{r.note ?? "Revenue movement"}</span>,
    },
    {
      key: "amount",
      header: "Amount",
      render: (r) =>
        r.direction === "CREDIT" ? (
          <span className="font-bold text-emerald-600">+{formatINR(r.amount)}</span>
        ) : (
          <span className="font-bold text-rose-600">−{formatINR(r.amount)}</span>
        ),
    },
    {
      key: "balanceAfter",
      header: "Balance after",
      render: (r) => <span className="text-ink-600">{formatINR(r.balanceAfter)}</span>,
    },
  ];

  const csvServiceCols: ReportColumn<ServiceRow>[] = [
    { key: "service", header: "Service" },
    { key: "product", header: "Product" },
    { key: "txnCount", header: "Transactions", format: "int" },
    { key: "totalVolume", header: "Volume", format: "money" },
    { key: "totalCharge", header: "Charges Collected", format: "money" },
    { key: "gstCollected", header: "GST", format: "money" },
    { key: "vendorCost", header: "Vendor Cost", format: "money" },
    { key: "grossCommission", header: "Gross Commission", format: "money" },
    { key: "tdsCollected", header: "TDS (2%)", format: "money" },
    { key: "netCommission", header: "Net Commission", format: "money" },
    { key: "platformRevenue", header: "Platform Revenue", format: "money" },
  ];

  const csvLegCols: ReportColumn<SettlementLegRow>[] = [
    { key: "leg", header: "Settlement Leg" },
    { key: "txnCount", header: "Transactions", format: "int" },
    { key: "totalVolume", header: "Volume", format: "money" },
    { key: "margin", header: "MDR Margin", format: "money" },
    { key: "grossCommission", header: "Chain Commission", format: "money" },
    { key: "companyNet", header: "Company Net", format: "money" },
  ];

  const maxRevenue = Math.max(1, ...(data?.byDay ?? []).map((d) => Math.abs(d.platformRevenue)));
  const instantMargin = (data?.posByLeg ?? []).find((r) => r.settlementType === "T0")?.margin ?? 0;
  const t1Margin = (data?.posByLeg ?? []).find((r) => r.settlementType === "T1")?.margin ?? 0;
  const qrInstantMargin = (data?.qrByLeg ?? []).find((r) => r.settlementType === "T0")?.margin ?? 0;
  const qrT1Margin = (data?.qrByLeg ?? []).find((r) => r.settlementType === "T1")?.margin ?? 0;

  // The Revenue Wallet / Company Earnings view is the platform OWNER's book —
  // master-admin only. Plain admins / finance use Commission Distributed instead.
  if (status !== "loading" && !isMaster) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Company Earnings & Revenue Wallet"
          description="The Revenue Wallet is the platform owner's book."
        />
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          This page is restricted to the master admin. For commission distribution
          figures, use <span className="font-semibold">Commission Distributed</span> or{" "}
          <span className="font-semibold">Per-Txn Earnings</span>.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Company Earnings & Revenue Wallet"
        description="Company earnings from the MDR margin (service − vendor) credited to the Revenue Wallet, with upline commissions paid out of it — master-admin only."
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-ink-500">
              From
              <input
                type="date"
                className={`${inputCls} mt-1 block`}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label className="text-xs text-ink-500">
              To
              <input
                type="date"
                className={`${inputCls} mt-1 block`}
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
            <Button onClick={load} isLoading={loading}>
              <RefreshCw className="mr-2 h-4 w-4" /> Apply
            </Button>
            {data && (
              <>
                <Button
                  variant="outline"
                  onClick={() =>
                    downloadCSV(
                      `revenue-report-${data.from}-to-${data.to}`,
                      data.byService,
                      csvServiceCols
                    )
                  }
                >
                  <Download className="mr-2 h-4 w-4" /> CSV
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    downloadPDF(
                      "Revenue Report",
                      data.byService,
                      csvServiceCols,
                      { subtitle: `${data.from} to ${data.to}` }
                    )
                  }
                >
                  <Download className="mr-2 h-4 w-4" /> PDF
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    downloadZIP(
                      `revenue-report-${data.from}-to-${data.to}`,
                      data.byService,
                      csvServiceCols
                    )
                  }
                >
                  <Download className="mr-2 h-4 w-4" /> ZIP
                </Button>
              </>
            )}
          </div>
        }
      />

      {error && (
        <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</div>
      )}

      {loading && !data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <StatSkeleton key={i} />
            ))}
          </div>
          <PageSpinner label="Loading revenue report…" />
        </div>
      )}

      {data && (
        <>
          {/* Revenue wallet — the actual company earnings account */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-700 via-emerald-600 to-teal-500 p-6 text-white shadow-lg">
            <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-white/80">
                  Revenue Wallet
                </p>
                <p className="mt-2 font-display text-3xl font-bold">
                  {formatINR(data.wallet.balance)}
                </p>
                <p className="mt-1 text-xs text-white/70">
                  {data.wallet.accountName
                    ? `Company earnings · ${data.wallet.accountName}`
                    : "No revenue account configured"}
                </p>
              </div>
              <div className="flex gap-2">
                <div className="rounded-xl bg-white/15 p-3 text-right">
                  <p className="text-[11px] uppercase tracking-wider text-white/80">Margin in (range)</p>
                  <p className="mt-1 font-display text-xl font-bold">
                    +{formatINR(data.wallet.creditedInRange)}
                  </p>
                </div>
                <div className="rounded-xl bg-white/15 p-3 text-right">
                  <p className="text-[11px] uppercase tracking-wider text-white/80">Commission out (range)</p>
                  <p className="mt-1 font-display text-xl font-bold">
                    −{formatINR(data.wallet.commissionPaidInRange)}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Summary stats */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Transactions" value={formatNumber(data.totals.txnCount)} />
            <Stat label="Total Volume" value={formatINR(data.totals.totalVolume)} />
            <Stat label="Charges Collected" value={formatINR(data.totals.totalCharge)} />
            <Stat
              label="Platform Revenue (range)"
              value={formatINR(data.totals.platformRevenue)}
              tone={data.totals.platformRevenue >= 0 ? "good" : "bad"}
            />
          </div>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Gross Commission" value={formatINR(data.totals.grossCommission)} />
            <Stat label="TDS Collected (2%)" value={formatINR(data.totals.tdsCollected)} />
            <Stat label="Net Commission Paid" value={formatINR(data.totals.netCommission)} />
            <Stat
              label="Revenue = Charges − GST − Vendor − Comm."
              value={formatINR(data.totals.platformRevenue)}
              tone="good"
            />
          </div>

          {/* Daily revenue trend */}
          {data.byDay.length > 1 && (
            <div className="rounded-2xl border border-ink-100 bg-white p-5">
              <p className="mb-4 text-sm font-semibold text-ink-800">Daily platform revenue</p>
              <div className="flex h-40 items-end gap-1 overflow-x-auto">
                {data.byDay.map((d) => (
                  <div
                    key={d.date}
                    className="group relative flex min-w-[14px] flex-1 flex-col items-center justify-end"
                  >
                    <div
                      className={`w-full rounded-t transition ${
                        d.platformRevenue >= 0
                          ? "bg-emerald-500 group-hover:bg-emerald-600"
                          : "bg-rose-400 group-hover:bg-rose-500"
                      }`}
                      style={{
                        height: `${Math.max(3, (Math.abs(d.platformRevenue) / maxRevenue) * 100)}%`,
                      }}
                    />
                    <div className="pointer-events-none absolute bottom-full mb-1 hidden whitespace-nowrap rounded-lg bg-ink-900 px-2 py-1 text-[10px] text-white group-hover:block">
                      {d.date} · Revenue {formatINR(d.platformRevenue)} · {d.txnCount} txns
                    </div>
                  </div>
                ))}
              </div>
              {data.byDay.length > 0 && (
                <div className="mt-2 flex justify-between text-[10px] text-ink-400">
                  <span>{data.byDay[0].date}</span>
                  <span>{data.byDay[data.byDay.length - 1].date}</span>
                </div>
              )}
            </div>
          )}

          {/* Service-wise breakdown */}
          <div>
            <p className="mb-3 text-sm font-semibold text-ink-800">
              Revenue by service
            </p>
            <DataTable columns={serviceColumns} data={data.byService} loading={loading} />
          </div>

          {/* POS company margin by settlement leg (T+1 vs Instant) */}
          {data.posByLeg.length > 0 && (
            <div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-ink-800">
                  POS company margin by settlement leg
                </p>
                <Button
                  variant="outline"
                  onClick={() =>
                    downloadCSV(
                      `pos-margin-by-leg-${data.from}-to-${data.to}`,
                      data.posByLeg,
                      csvLegCols
                    )
                  }
                >
                  <Download className="mr-2 h-4 w-4" /> CSV
                </Button>
              </div>
              <div className="mb-3 grid grid-cols-2 gap-4">
                <Stat label="Instant (T+0) margin" value={formatINR(instantMargin)} tone="good" />
                <Stat label="T+1 margin" value={formatINR(t1Margin)} tone="good" />
              </div>
              <DataTable columns={legColumns} data={data.posByLeg} loading={loading} />
            </div>
          )}

          {/* QR company margin by settlement leg (T+1 vs Instant) */}
          {data.qrByLeg.length > 0 && (
            <div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-ink-800">
                  QR company margin by settlement leg
                </p>
                <Button
                  variant="outline"
                  onClick={() =>
                    downloadCSV(
                      `qr-margin-by-leg-${data.from}-to-${data.to}`,
                      data.qrByLeg,
                      csvLegCols
                    )
                  }
                >
                  <Download className="mr-2 h-4 w-4" /> CSV
                </Button>
              </div>
              <div className="mb-3 grid grid-cols-2 gap-4">
                <Stat label="Instant (T+0) margin" value={formatINR(qrInstantMargin)} tone="good" />
                <Stat label="T+1 margin" value={formatINR(qrT1Margin)} tone="good" />
              </div>
              <DataTable columns={legColumns} data={data.qrByLeg} loading={loading} />
            </div>
          )}

          {/* Commission by tier */}
          <div>
            <p className="mb-3 text-sm font-semibold text-ink-800">
              Commission by tier
            </p>
            <DataTable columns={tierColumns} data={data.byTier} loading={loading} />
          </div>

          {/* Daily breakdown table */}
          {data.byDay.length > 0 && (
            <div>
              <p className="mb-3 text-sm font-semibold text-ink-800">
                Daily breakdown
              </p>
              <DataTable columns={dailyColumns} data={data.byDay} loading={loading} />
            </div>
          )}

          {/* Revenue wallet ledger — latest company earnings credits */}
          {data.wallet.recent.length > 0 && (
            <div>
              <p className="mb-3 text-sm font-semibold text-ink-800">
                Revenue wallet ledger (latest 50)
              </p>
              <DataTable
                columns={walletColumns}
                data={data.wallet.recent}
                loading={loading}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
