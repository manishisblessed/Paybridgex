"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
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
    <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white">
      {showHeader && (
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
          <div>
            <h3 className="font-display text-base font-semibold text-ink-900">
              Recent transactions
            </h3>
            <p className="text-xs text-ink-500">
              {loading
                ? "Loading…"
                : data.length === 0
                  ? "No transactions yet"
                  : `Showing latest ${data.length} entries`}
            </p>
          </div>
          <Link
            href="/dashboard/transactions"
            className="text-xs font-semibold text-brand-700 hover:underline"
          >
            View all
          </Link>
        </div>
      )}
      <div className="overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center gap-2 px-5 py-12 text-sm text-ink-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading transactions…
          </div>
        ) : data.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-ink-500">
            No live transactions yet. Completed payments will show up here.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-ink-50/60 text-left text-xs uppercase tracking-wider text-ink-500">
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
            <tbody className="divide-y divide-ink-100 text-ink-800">
              {data.map((t) => (
                <tr key={t.id} className="hover:bg-ink-50/40">
                  <td className="px-5 py-3 font-mono text-xs">{t.id}</td>
                  <td className="px-5 py-3">{t.service}</td>
                  <td className="px-5 py-3 text-ink-600">{t.customer}</td>
                  <td className="px-5 py-3 text-right font-semibold">
                    {formatINR(t.amount)}
                  </td>
                  {showCommission && (
                    <td className="px-5 py-3 text-right text-emerald-700">
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
