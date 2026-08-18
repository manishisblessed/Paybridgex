"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  CircleDollarSign,
  TrendingUp,
  Layers,
  Download,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Panel, StatTile, FilterBar, FilterField, SectionTitle } from "@/components/dashboard/ui";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Pagination } from "@/components/ui/Pagination";
import { formatINR } from "@/lib/utils";

async function fetcher<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error("Failed to load");
  return r.json();
}

type EarningsResponse = {
  totalEarnings: number;
  totalGross: number;
  totalTds: number;
  totalCredits: number;
  byService: Array<{ service: string; amount: number; count: number }>;
  credits: Array<{
    id: string;
    tier: string;
    amount: number;
    grossAmount: number | null;
    tdsAmount: number;
    service: string;
    txnAmount: number;
    txnRefId: string;
    txnUserId: string;
    customer: string | null;
    createdAt: string;
  }>;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

function serviceName(code: string) {
  const map: Record<string, string> = {
    BILL_ELECTRICITY: "Electricity",
    BILL_WATER: "Water",
    BILL_GAS: "Gas",
    BILL_CREDIT_CARD: "Credit Card",
    BILL_EDUCATION: "Education",
    BILL_INSURANCE: "Insurance",
    RECHARGE_MOBILE: "Mobile Recharge",
    RECHARGE_DTH: "DTH Recharge",
    DMT_IMPS: "IMPS",
    DMT_NEFT: "NEFT",
    AEPS_WITHDRAW: "AePS Withdraw",
    PAN_CARD: "PAN Card",
    POS: "POS Settlement",
    QR: "QR Settlement",
    PG: "PG Settlement",
    WALLET_TOPUP: "Wallet Top-up",
  };
  return map[code] ?? code.replace(/_/g, " ");
}

function tierBadge(tier: string) {
  const v: Record<string, "success" | "brand" | "warning" | "default"> = {
    RETAILER: "success",
    DISTRIBUTOR: "brand",
    MASTER: "warning",
    SUPER: "default",
  };
  return <Badge variant={v[tier] ?? "default"}>{tier}</Badge>;
}

export default function EarningsPage() {
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const params = new URLSearchParams({ page: String(page), pageSize: "25" });
  if (from) params.set("from", from);
  if (to) params.set("to", to);

  const { data, isLoading } = useSWR<EarningsResponse>(
    `/api/network/earnings?${params}`,
    fetcher,
    { revalidateOnFocus: false, keepPreviousData: true }
  );

  const credits = data?.credits ?? [];
  const pagination = data?.pagination;
  const byService = data?.byService ?? [];

  const cols: Column<(typeof credits)[0]>[] = [
    {
      key: "createdAt",
      header: "Date",
      render: (r) => (
        <span className="text-xs">
          {new Date(r.createdAt).toLocaleString("en-IN", {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      ),
    },
    { key: "tier", header: "Tier", render: (r) => tierBadge(r.tier) },
    { key: "service", header: "Service", render: (r) => <span className="text-xs">{serviceName(r.service)}</span> },
    {
      key: "txnAmount",
      header: "Txn Amount",
      align: "right",
      render: (r) => <span className="text-xs text-ink-600">{formatINR(r.txnAmount)}</span>,
    },
    {
      key: "grossAmount",
      header: "Gross",
      align: "right",
      render: (r) => (
        <span className="text-xs text-ink-600">
          {r.grossAmount !== null ? formatINR(r.grossAmount) : "—"}
        </span>
      ),
    },
    {
      key: "tdsAmount",
      header: "TDS (2%)",
      align: "right",
      render: (r) => <span className="text-xs text-rose-600">− {formatINR(r.tdsAmount)}</span>,
    },
    {
      key: "amount",
      header: "Net Credited",
      align: "right",
      render: (r) => <span className="font-semibold text-emerald-700">{formatINR(r.amount)}</span>,
    },
    {
      key: "txnRefId",
      header: "Txn Ref",
      render: (r) => <span className="font-mono text-xs">{r.txnRefId ?? "—"}</span>,
    },
  ];

  return (
    <div className="min-w-0 space-y-6">
      <Reveal distance={14} duration={0.4}>
        <PageHeader
          eyebrow="Earnings"
          title="My Commission Earnings"
          description="Track your commission income from transactions across your network."
        />
      </Reveal>

      <Stagger stagger={0.05} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StaggerItem distance={14} duration={0.35}>
          <StatTile
            label="Net Earnings (credited)"
            countTo={data?.totalEarnings ?? 0}
            prefix="₹"
            decimals={2}
            icon={CircleDollarSign}
            tone="dark"
            loading={!data}
          />
        </StaggerItem>
        <StaggerItem distance={14} duration={0.35}>
          <StatTile
            label="TDS Withheld (2%)"
            countTo={data?.totalTds ?? 0}
            prefix="₹"
            decimals={2}
            icon={Download}
            tone="amber"
            loading={!data}
          />
        </StaggerItem>
        <StaggerItem distance={14} duration={0.35}>
          <StatTile
            label="Total Credits"
            countTo={data?.totalCredits ?? 0}
            icon={TrendingUp}
            tone="brand"
            loading={!data}
          />
        </StaggerItem>
        <StaggerItem distance={14} duration={0.35}>
          <StatTile
            label="Active Services"
            countTo={byService.length}
            icon={Layers}
            tone="violet"
            loading={!data}
          />
        </StaggerItem>
      </Stagger>

      {/* Service breakdown */}
      {byService.length > 0 && (
        <Reveal distance={16} duration={0.45}>
          <Panel>
            <SectionTitle title="Earnings by service" className="mb-3" />
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {byService
                .sort((a, b) => b.amount - a.amount)
                .map((s) => (
                  <div key={s.service} className="flex items-center justify-between rounded-xl border border-ink-100 px-4 py-3 transition-colors hover:border-brand-200 hover:bg-brand-50/30">
                    <div>
                      <div className="text-sm font-medium text-ink-900">{serviceName(s.service)}</div>
                      <div className="text-xs text-ink-500">{s.count} transactions</div>
                    </div>
                    <div className="text-sm font-semibold text-emerald-700">{formatINR(s.amount)}</div>
                  </div>
                ))}
            </div>
          </Panel>
        </Reveal>
      )}

      {/* Filters */}
      <FilterBar>
        <FilterField label="From">
          <input
            type="date"
            value={from}
            onChange={(e) => { setFrom(e.target.value); setPage(1); }}
            className="rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
          />
        </FilterField>
        <FilterField label="To">
          <input
            type="date"
            value={to}
            onChange={(e) => { setTo(e.target.value); setPage(1); }}
            className="rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
          />
        </FilterField>
      </FilterBar>

      <Reveal distance={16} duration={0.45}>
        <DataTable
          title="Commission credits"
          columns={cols}
          data={credits}
          loading={isLoading}
          empty="No commission credits yet. Start transacting to earn."
        />
      </Reveal>

      {pagination && pagination.totalPages > 1 && (
        <Pagination page={page} pageSize={pagination.pageSize} total={pagination.total} onPageChange={setPage} />
      )}
    </div>
  );
}
