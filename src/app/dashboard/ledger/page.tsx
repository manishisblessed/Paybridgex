"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BookOpenCheck,
  Search,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  FileDown,
} from "lucide-react";
import { ServicePageHeader } from "@/components/dashboard/ServicePage";
import { Input, Select } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { FilterBar, TablePro, TableEmptyRow, TableSkeletonRows, StatusPill } from "@/components/dashboard/ui";
import { Reveal } from "@/components/motion";
import { formatINR } from "@/lib/utils";
import { downloadCSV, downloadPDF, downloadZIP, type ReportColumn } from "@/lib/reports";

type WalletTxn = {
  id: string;
  direction: "CREDIT" | "DEBIT";
  reason: string;
  amount: number;
  balanceAfter: number;
  note: string | null;
  refType: string | null;
  refId: string | null;
  createdAt: string;
};

type LedgerData = {
  txns: WalletTxn[];
  total: number;
  page: number;
  pageSize: number;
};

const PAGE_SIZE = 500;

const REASON_LABELS: Record<string, string> = {
  TOPUP: "Wallet top-up",
  WITHDRAW: "Withdrawal",
  TRANSACTION: "Service txn",
  COMMISSION: "Commission",
  REVERSAL: "Refund / reversal",
  ADJUSTMENT: "Adjustment",
  FUND_TRANSFER_IN: "Fund received",
  FUND_TRANSFER_OUT: "Fund sent",
  FEE: "Fee",
  PENALTY: "Penalty",
  PAYOUT: "Payout",
  SETTLEMENT: "Settlement",
  AEPS_SETTLEMENT: "AePS settlement",
  RENTAL: "POS rental",
  POS_SETTLEMENT: "POS settlement",
  PARENT_PUSH: "Received from parent",
  PARENT_PULL: "Pulled by parent",
  PLATFORM_REVENUE: "Platform revenue",
};

const REASON_OPTIONS = ["All", ...Object.keys(REASON_LABELS)];

export default function LedgerPage() {
  const [data, setData] = useState<LedgerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [direction, setDirection] = useState("All");
  const [reason, setReason] = useState("All");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (direction !== "All") params.set("direction", direction);
      if (reason !== "All") params.set("reason", reason);
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/wallet/transactions?${params}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [page, direction, reason, q]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  // Reset to page 1 whenever a filter changes.
  useEffect(() => {
    setPage(1);
  }, [direction, reason, q]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const ledgerCols: ReportColumn<WalletTxn>[] = [
    { key: "createdAt", header: "Date", render: (r) => new Date(r.createdAt).toLocaleString("en-IN") },
    { key: "direction", header: "Type" },
    { key: "reason", header: "Reason", render: (r) => REASON_LABELS[r.reason] ?? r.reason },
    { key: "note", header: "Description" },
    { key: "refId", header: "Reference" },
    { key: "amount", header: "Amount (INR)", format: "money" },
    { key: "balanceAfter", header: "Balance after (INR)", format: "money" },
  ];

  function exportCsv() {
    if (!data) return;
    downloadCSV(`ledger-page-${page}`, data.txns, ledgerCols);
  }

  function exportPdf() {
    if (!data) return;
    downloadPDF("Wallet Ledger", data.txns, ledgerCols);
  }

  function exportZip() {
    if (!data) return;
    downloadZIP(`ledger-page-${page}`, data.txns, ledgerCols);
  }

  return (
    <div>
      <Reveal distance={14} duration={0.4}>
        <ServicePageHeader
          icon={BookOpenCheck}
          title="Wallet Ledger"
          description="Every credit and debit on your wallet — commissions, transactions, payouts, settlements and more."
        />
      </Reveal>

      <FilterBar className="mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by note or reference..."
            className="pl-9"
          />
        </div>
        <Select value={direction} onChange={(e) => setDirection(e.target.value)} className="w-36">
          {["All", "CREDIT", "DEBIT"].map((d) => (
            <option key={d} value={d}>
              {d === "All" ? "All types" : d}
            </option>
          ))}
        </Select>
        <Select value={reason} onChange={(e) => setReason(e.target.value)} className="w-48">
          {REASON_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r === "All" ? "All reasons" : REASON_LABELS[r] ?? r}
            </option>
          ))}
        </Select>
        <Button variant="outline" size="md" onClick={exportCsv} disabled={!data?.txns.length}>
          <FileDown className="h-4 w-4" />
          CSV
        </Button>
        <Button variant="outline" size="md" onClick={exportPdf} disabled={!data?.txns.length}>
          <FileDown className="h-4 w-4" />
          PDF
        </Button>
        <Button variant="outline" size="md" onClick={exportZip} disabled={!data?.txns.length}>
          <FileDown className="h-4 w-4" />
          ZIP
        </Button>
      </FilterBar>

      <Reveal distance={16} duration={0.45}>
        <TablePro
          title="Ledger entries"
          description={
            data
              ? `${data.total.toLocaleString("en-IN")} total entries · showing ${data.txns.length} (page ${data.page} of ${totalPages})`
              : "Loading…"
          }
          action={
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={loading || page <= 1}
              >
                <ChevronLeft className="h-4 w-4" /> Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={loading || page >= totalPages}
              >
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </>
          }
        >
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Description</th>
                <th className="text-right">Amount</th>
                <th className="text-right">Balance after</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {!data?.txns.length ? (
                loading ? (
                  <TableSkeletonRows rows={8} cols={5} />
                ) : (
                  <TableEmptyRow
                    colSpan={5}
                    icon={BookOpenCheck}
                    message="No ledger entries match your filters."
                  />
                )
              ) : (
                data.txns.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        {t.direction === "CREDIT" ? (
                          <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-50 text-emerald-600">
                            <ArrowDownLeft className="h-3.5 w-3.5" />
                          </span>
                        ) : (
                          <span className="grid h-7 w-7 place-items-center rounded-lg bg-rose-50 text-rose-600">
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          </span>
                        )}
                        <StatusPill status={t.direction} />
                      </div>
                    </td>
                    <td>
                      <div className="font-medium text-ink-900">
                        {REASON_LABELS[t.reason] ?? t.reason}
                      </div>
                      {t.note && <div className="whitespace-normal text-xs text-ink-500">{t.note}</div>}
                      {t.refId && <div className="text-[11px] text-ink-400 font-mono">{t.refId}</div>}
                    </td>
                    <td
                      className={`text-right font-semibold ${
                        t.direction === "CREDIT" ? "text-emerald-700" : "text-rose-700"
                      }`}
                    >
                      {t.direction === "CREDIT" ? "+" : "−"}
                      {formatINR(t.amount)}
                    </td>
                    <td className="text-right text-ink-600">{formatINR(t.balanceAfter)}</td>
                    <td className="text-xs text-ink-500 whitespace-nowrap">
                      {new Date(t.createdAt).toLocaleString("en-IN", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </TablePro>
      </Reveal>
    </div>
  );
}
