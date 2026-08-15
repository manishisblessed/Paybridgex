"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Wallet,
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowUpRight,
  ArrowDownLeft,
  RefreshCw,
  ExternalLink,
  AlertCircle,
  Loader2,
  FileDown,
} from "lucide-react";
import Link from "next/link";
import { ServicePageHeader } from "@/components/dashboard/ServicePage";
import { Input, Label } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import {
  TransactionResult,
  type TxnResult,
} from "@/components/dashboard/TransactionResult";
import { Badge } from "@/components/ui/Badge";
import { generateRefId, formatINR } from "@/lib/utils";
import { useAuth } from "@/lib/useAuth";

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

type WalletData = {
  balance: number;
  monthlyIn: number;
  monthlyOut: number;
  recentTxns: WalletTxn[];
};

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
  RENTAL: "POS rental",
};

type PendingTopup = {
  refId: string;
  amount: number;
  paymentUrl?: string;
  upiIntent?: string;
};

export default function WalletPage() {
  const { session } = useAuth();
  const [data, setData] = useState<WalletData | null>(null);
  const [fetching, setFetching] = useState(true);
  const [mode, setMode] = useState<"add" | "withdraw">("add");
  const [amount, setAmount] = useState("");
  const [payVia, setPayVia] = useState<"page" | "vpa">("page");
  const [vpa, setVpa] = useState("");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<PendingTopup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TxnResult>(null);
  const [stmtPeriod, setStmtPeriod] = useState<"this-month" | "last-month" | "last-90">("this-month");
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  function statementUrl(format: "pdf" | "csv") {
    const now = new Date();
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    let from: Date;
    let to: Date = now;
    if (stmtPeriod === "last-month") {
      from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      to = new Date(now.getFullYear(), now.getMonth(), 0);
    } else if (stmtPeriod === "last-90") {
      from = new Date(now.getTime() - 90 * 24 * 3600_000);
    } else {
      from = new Date(now.getFullYear(), now.getMonth(), 1);
    }
    return `/api/wallet/statement?from=${iso(from)}&to=${iso(to)}&format=${format}`;
  }

  const fetchWallet = useCallback(async () => {
    try {
      setFetching(true);
      const res = await fetch("/api/wallet");
      if (res.ok) setData(await res.json());
    } finally {
      setFetching(false);
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const checkTopup = useCallback(
    async (topup: PendingTopup): Promise<boolean> => {
      try {
        const res = await fetch(`/api/wallet/topup?refId=${encodeURIComponent(topup.refId)}`);
        if (!res.ok) return false;
        const d = (await res.json()) as { status: string };
        if (d.status === "SUCCESS") {
          stopPolling();
          setPending(null);
          setResult({
            refId: topup.refId,
            service: "Wallet top-up",
            amount: topup.amount,
            meta: { Status: "Credited to wallet" },
          });
          fetchWallet();
          return true;
        }
        if (d.status === "FAILED") {
          stopPolling();
          setPending(null);
          setError("Payment failed or expired. No amount was credited — try again.");
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [fetchWallet, stopPolling]
  );

  const startPolling = useCallback(
    (topup: PendingTopup) => {
      stopPolling();
      let attempts = 0;
      pollTimer.current = setInterval(async () => {
        attempts += 1;
        const done = await checkTopup(topup);
        // Give up after ~5 minutes; user can still hit "Check status".
        if (!done && attempts >= 60) stopPolling();
      }, 5000);
    },
    [checkTopup, stopPolling]
  );

  useEffect(() => {
    fetchWallet();
    // Resume a top-up when redirected back from the payment page
    // (?topup=TOPUPXXXX in the callback URL).
    const params = new URLSearchParams(window.location.search);
    const refId = params.get("topup");
    if (refId?.startsWith("TOPUP")) {
      const resumed = { refId, amount: 0 };
      setPending(resumed);
      checkTopup(resumed);
      startPolling(resumed);
    }
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const balance = data?.balance ?? session?.walletBalance ?? 0;

  async function submitTopup(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(amount);
    if (!amt || amt <= 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/wallet/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amt,
          ...(payVia === "vpa" && vpa ? { vpa } : {}),
          idempotencyKey: generateRefId("TOPREQ"),
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(typeof d.error === "string" ? d.error : "Could not start the top-up. Try again.");
        return;
      }
      const topup: PendingTopup = {
        refId: d.refId,
        amount: amt,
        paymentUrl: d.paymentUrl,
        upiIntent: d.upiIntent,
      };
      setPending(topup);
      setAmount("");
      if (d.paymentUrl) window.open(d.paymentUrl, "_blank", "noopener");
      startPolling(topup);
    } catch {
      setError("Network error — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <ServicePageHeader
        icon={Wallet}
        title="Paybridgex Wallet"
        description="Top-up your wallet instantly via UPI, or view your balance history."
      />

      <div className="mb-8 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1 relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-700 via-brand-600 to-accent-500 p-6 text-white shadow-glow">
          <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-widest text-white/80">
              Available balance
            </p>
            <button
              onClick={fetchWallet}
              disabled={fetching}
              className="grid h-7 w-7 place-items-center rounded-lg bg-white/15 text-white/80 transition hover:bg-white/25 disabled:animate-spin"
              title="Refresh balance"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mt-2 font-display text-3xl font-bold">
            {formatINR(balance)}
          </p>
          <div className="mt-6 grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-xl bg-white/15 p-3">
              <p className="opacity-80">This month in</p>
              <p className="mt-1 font-display text-lg font-bold">
                {formatINR(data?.monthlyIn ?? 0)}
              </p>
            </div>
            <div className="rounded-xl bg-white/15 p-3">
              <p className="opacity-80">This month out</p>
              <p className="mt-1 font-display text-lg font-bold">
                {formatINR(data?.monthlyOut ?? 0)}
              </p>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 rounded-2xl border border-ink-100 bg-white p-6">
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { id: "add", label: "Add money", icon: ArrowDownToLine },
                {
                  id: "withdraw",
                  label: "Withdraw to bank",
                  icon: ArrowUpFromLine,
                },
              ] as const
            ).map((m) => {
              const Icon = m.icon;
              const active = mode === m.id;
              return (
                <button
                  type="button"
                  key={m.id}
                  onClick={() => setMode(m.id)}
                  className={`flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-2.5 text-sm font-semibold transition ${
                    active
                      ? "border-brand-500 bg-brand-50 text-brand-700"
                      : "border-ink-100 bg-white text-ink-700 hover:border-ink-200"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {m.label}
                </button>
              );
            })}
          </div>

          {mode === "withdraw" ? (
            <div className="mt-5 rounded-xl border border-ink-100 bg-ink-50/60 p-5 text-sm text-ink-700">
              <p className="font-semibold text-ink-900">
                Withdrawals run through Payouts
              </p>
              <p className="mt-1 text-xs text-ink-600">
                Send money from your wallet to any bank account or UPI ID with
                live status tracking and UTR receipts.
              </p>
              <Link href="/dashboard/payout">
                <Button size="lg" className="mt-4 w-full">
                  Go to Payouts
                  <ArrowUpRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          ) : pending ? (
            <div className="mt-5 rounded-xl border border-brand-200 bg-brand-50/60 p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-brand-800">
                <Loader2 className="h-4 w-4 animate-spin" />
                Waiting for your payment…
              </div>
              <p className="mt-1 text-xs text-ink-600">
                Reference <span className="font-mono">{pending.refId}</span>
                {pending.amount > 0 && <> · {formatINR(pending.amount)}</>}.
                Your wallet is credited automatically once the payment
                completes.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {pending.paymentUrl && (
                  <a href={pending.paymentUrl} target="_blank" rel="noopener noreferrer">
                    <Button type="button" variant="outline">
                      <ExternalLink className="h-4 w-4" />
                      Reopen payment page
                    </Button>
                  </a>
                )}
                <Button type="button" variant="outline" onClick={() => checkTopup(pending)}>
                  <RefreshCw className="h-4 w-4" />
                  Check status
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    stopPolling();
                    setPending(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={submitTopup} className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="amount">Amount (₹)</Label>
                <Input
                  id="amount"
                  type="number"
                  required
                  min={1}
                  max={200000}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Enter amount"
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {[500, 1000, 2000, 5000, 10000, 25000].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setAmount(String(v))}
                      className="rounded-full border border-ink-200 px-3 py-1 text-xs font-medium text-ink-700 hover:border-brand-300 hover:text-brand-700"
                    >
                      {formatINR(v)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="sm:col-span-2">
                <Label>Payment method</Label>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  {(
                    [
                      { id: "page", label: "Payment page (UPI / cards)" },
                      { id: "vpa", label: "UPI collect to my VPA" },
                    ] as const
                  ).map((m) => (
                    <button
                      type="button"
                      key={m.id}
                      onClick={() => setPayVia(m.id)}
                      className={`rounded-xl border-2 px-3 py-2 text-xs font-semibold transition ${
                        payVia === m.id
                          ? "border-brand-500 bg-brand-50 text-brand-700"
                          : "border-ink-100 bg-white text-ink-700 hover:border-ink-200"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {payVia === "vpa" && (
                <div className="sm:col-span-2">
                  <Label htmlFor="vpa">Your UPI ID</Label>
                  <Input
                    id="vpa"
                    required
                    placeholder="name@bank"
                    value={vpa}
                    onChange={(e) => setVpa(e.target.value.trim())}
                  />
                  <p className="mt-1 text-[11px] text-ink-400">
                    A collect request will be sent to this UPI ID — approve it
                    in your UPI app.
                  </p>
                </div>
              )}

              {error && (
                <div className="sm:col-span-2 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="sm:col-span-2">
                <Button type="submit" size="lg" className="w-full" isLoading={loading} disabled={loading}>
                  {loading
                    ? "Starting top-up…"
                    : `Add ${amount ? formatINR(Number(amount)) : "money"} to wallet`}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Wallet transaction history — real data from DB */}
      <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
          <div>
            <h3 className="font-display text-base font-semibold text-ink-900">
              Wallet history
            </h3>
            <p className="text-xs text-ink-500">
              {data?.recentTxns.length
                ? `Showing latest ${data.recentTxns.length} entries`
                : "No wallet transactions yet"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={stmtPeriod}
              onChange={(e) => setStmtPeriod(e.target.value as typeof stmtPeriod)}
              className="rounded-xl border border-ink-200 bg-white px-3 py-2 text-xs font-medium text-ink-700 outline-none focus:border-brand-400"
              title="Statement period"
            >
              <option value="this-month">This month</option>
              <option value="last-month">Last month</option>
              <option value="last-90">Last 90 days</option>
            </select>
            <a href={statementUrl("pdf")} target="_blank" rel="noopener noreferrer">
              <Button type="button" variant="outline">
                <FileDown className="h-4 w-4" />
                PDF
              </Button>
            </a>
            <a href={statementUrl("csv")} target="_blank" rel="noopener noreferrer">
              <Button type="button" variant="outline">
                <FileDown className="h-4 w-4" />
                CSV
              </Button>
            </a>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-ink-50/60 text-left text-xs uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-5 py-3 font-semibold">Type</th>
                <th className="px-5 py-3 font-semibold">Description</th>
                <th className="px-5 py-3 font-semibold text-right">Amount</th>
                <th className="px-5 py-3 font-semibold text-right">
                  Balance after
                </th>
                <th className="px-5 py-3 font-semibold">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 text-ink-800">
              {!data?.recentTxns.length ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-5 py-12 text-center text-sm text-ink-500"
                  >
                    {fetching
                      ? "Loading..."
                      : "No wallet transactions yet. Your transaction history will appear here."}
                  </td>
                </tr>
              ) : (
                data.recentTxns.map((t) => (
                  <tr key={t.id} className="hover:bg-ink-50/40">
                    <td className="px-5 py-3">
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
                        <Badge
                          variant={
                            t.direction === "CREDIT" ? "success" : "danger"
                          }
                        >
                          {t.direction}
                        </Badge>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <div className="font-medium text-ink-900">
                        {REASON_LABELS[t.reason] ?? t.reason}
                      </div>
                      {t.note && (
                        <div className="text-xs text-ink-500">{t.note}</div>
                      )}
                    </td>
                    <td
                      className={`px-5 py-3 text-right font-semibold ${t.direction === "CREDIT" ? "text-emerald-700" : "text-rose-700"}`}
                    >
                      {t.direction === "CREDIT" ? "+" : "−"}
                      {formatINR(t.amount)}
                    </td>
                    <td className="px-5 py-3 text-right text-ink-600">
                      {formatINR(t.balanceAfter)}
                    </td>
                    <td className="px-5 py-3 text-xs text-ink-500 whitespace-nowrap">
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
        </div>
      </div>

      <TransactionResult result={result} onClose={() => setResult(null)} />
    </div>
  );
}
