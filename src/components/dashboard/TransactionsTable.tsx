"use client";

import Link from "next/link";
import { Loader2, ArrowRight, ReceiptText } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import type { Transaction } from "@/lib/data";
import { formatINR } from "@/lib/utils";

const statusVariant: Record<
  Transaction["status"],
  "success" | "warning" | "danger"
> = {
  Success: "success",
  Pending: "warning",
  Failed: "danger",
};

export function TransactionsTable({
  data = [],
  showHeader = true,
  loading = false,
  showCommission = true,
}: {
  data?: Transaction[];
  showHeader?: boolean;
  loading?: boolean;
  /** Hide the Commission column (e.g. for retailers, where the settlement-rail
   *  commission on a txn belongs to the upline, not the retailer). */
  showCommission?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-sm">
      {showHeader && (
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
          <div>
            <h3 className="flex items-center gap-2 font-display text-base font-semibold text-ink-900">
              <span className="inline-block h-4 w-1 rounded-full bg-gradient-to-b from-brand-500 to-accent-500" aria-hidden />
              Recent transactions
            </h3>
            <p className="mt-0.5 text-xs text-ink-500">
              {loading
                ? "Loading…"
                : data.length === 0
                  ? "No transactions yet"
                  : `Showing latest ${data.length} entries`}
            </p>
          </div>
          <Link
            href="/dashboard/transactions"
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 transition-colors hover:text-brand-600"
          >
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      )}
      <div className="overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center gap-2 px-5 py-12 text-sm text-ink-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading transactions…
          </div>
        ) : data.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-5 py-12 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-2xl border border-dashed border-ink-200 bg-ink-50/60 text-ink-300">
              <ReceiptText className="h-5 w-5" />
            </span>
            <p className="max-w-xs text-sm text-ink-500">
              No live transactions yet. Completed payments will show up here.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-ink-50/60 text-left text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-5 py-3 font-semibold">Txn ID</th>
                <th className="px-5 py-3 font-semibold">Service</th>
                <th className="px-5 py-3 font-semibold">Customer</th>
                <th className="px-5 py-3 font-semibold text-right">Amount</th>
                {showCommission && (
                  <th className="px-5 py-3 font-semibold text-right">Commission</th>
                )}
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100/80 text-ink-800">
              {data.map((t) => (
                <tr key={t.id} className="transition-colors duration-150 hover:bg-brand-50/40">
                  <td className="px-5 py-3 font-mono text-xs">{t.id}</td>
                  <td className="px-5 py-3">{t.service}</td>
                  <td className="px-5 py-3 text-ink-600">{t.customer}</td>
                  <td className="px-5 py-3 text-right font-semibold">
                    {formatINR(t.amount)}
                  </td>
                  {showCommission && (
                    <td className="px-5 py-3 text-right font-medium text-accent-700">
                      +{formatINR(t.commission)}
                    </td>
                  )}
                  <td className="px-5 py-3">
                    <Badge variant={statusVariant[t.status]}>{t.status}</Badge>
                  </td>
                  <td className="px-5 py-3 text-xs text-ink-500">{t.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
