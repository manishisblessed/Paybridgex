"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { RefreshCw, Search, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input, Label, Select } from "@/components/ui/Input";
import { StatusPill } from "@/components/dashboard/ui/StatusPill";
import { useStepUp } from "@/components/security/StepUpProvider";
import { formatINR } from "@/lib/utils";

type TxnInfo = {
  refId: string;
  status: string;
  amount: number;
  partner: string | null;
  partnerTxnId: string | null;
  customer: string | null;
  createdAt: string;
  errorCode: string | null;
  user: { name: string; email: string } | null;
  gatewayId: string | null;
};

function istFull(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

export default function TopupResettlePage() {
  const { fetchWithStepUp } = useStepUp();

  const [refId, setRefId] = useState("");
  const [txn, setTxn] = useState<TxnInfo | null>(null);
  const [lookingUp, setLookingUp] = useState(false);

  const [verifiedStatus, setVerifiedStatus] = useState<"PAID" | "FAILED">("PAID");
  const [verifiedAmount, setVerifiedAmount] = useState("");
  const [utr, setUtr] = useState("");
  const [paymentMode, setPaymentMode] = useState("CARD");
  const [providerRef, setProviderRef] = useState("");
  const [settling, setSettling] = useState(false);
  const [result, setResult] = useState<{ status: string; amount?: number } | null>(null);

  const lookup = useCallback(async () => {
    const id = refId.trim();
    if (!id) return;
    setLookingUp(true);
    setTxn(null);
    setResult(null);
    try {
      const res = await fetch(`/api/admin/topup/resettle?refId=${encodeURIComponent(id)}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "Not found");
      setTxn(d.txn);
      if (d.txn.partnerTxnId) setProviderRef(d.txn.partnerTxnId);
      if (d.txn.amount) setVerifiedAmount(String(d.txn.amount));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setLookingUp(false);
    }
  }, [refId]);

  const settle = useCallback(async () => {
    if (!txn) return;
    setSettling(true);
    setResult(null);
    try {
      const body: Record<string, unknown> = {
        refId: txn.refId,
        verifiedStatus,
      };
      const amt = Number(verifiedAmount);
      if (amt > 0) body.verifiedAmount = amt;
      if (utr.trim()) body.utr = utr.trim();
      if (paymentMode) body.paymentMode = paymentMode;
      if (providerRef.trim()) body.providerRef = providerRef.trim();

      const res = await fetchWithStepUp("/api/admin/topup/resettle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "Settlement failed");
      setResult({ status: d.status, amount: d.amount });
      if (d.status === "SUCCESS") {
        toast.success(`Settled! ${formatINR(d.amount ?? 0)} credited to wallet.`);
      } else {
        toast.info(`Result: ${d.status}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Settlement failed");
    } finally {
      setSettling(false);
    }
  }, [txn, verifiedStatus, verifiedAmount, utr, paymentMode, providerRef, fetchWithStepUp]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Money Desk"
        title="PG Top-up Re-settle"
        description="Force-resettle a wallet top-up stuck in FAILED due to a missed PG webhook. Resets the transaction and runs the full MDR settlement engine."
      />

      {/* Lookup */}
      <div className="rounded-2xl border border-ink-100 bg-white p-6">
        <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-ink-500">
          1. Look up transaction
        </h3>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <Label>Transaction Ref ID</Label>
            <Input
              placeholder="TOPUP47D9QHMS3NEM"
              value={refId}
              onChange={(e) => setRefId(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && lookup()}
            />
          </div>
          <Button onClick={lookup} disabled={lookingUp || !refId.trim()} isLoading={lookingUp}>
            <Search className="mr-1.5 h-4 w-4" /> Look up
          </Button>
        </div>

        {txn && (
          <div className="mt-5 rounded-xl border border-ink-100 bg-ink-50/50 p-4">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-ink-400">Ref ID</p>
                <p className="font-mono font-medium text-ink-900">{txn.refId}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-ink-400">Status</p>
                <StatusPill status={txn.status} />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-ink-400">Amount</p>
                <p className="font-semibold text-ink-900">{formatINR(txn.amount)}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-ink-400">Gateway</p>
                <p className="text-ink-700">{txn.partner ?? "—"} {txn.gatewayId ? `(${txn.gatewayId})` : ""}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-ink-400">PG Order ID</p>
                <p className="font-mono text-xs text-ink-700">{txn.partnerTxnId ?? "—"}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-ink-400">Customer</p>
                <p className="text-ink-700">{txn.customer ?? "—"}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-ink-400">Retailer</p>
                <p className="text-ink-700">{txn.user?.name ?? "—"}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-ink-400">Date</p>
                <p className="text-ink-700">{istFull(txn.createdAt)}</p>
              </div>
              {txn.errorCode && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-ink-400">Error</p>
                  <p className="text-amber-600">{txn.errorCode}</p>
                </div>
              )}
            </div>

            {txn.status !== "FAILED" && (
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {txn.status === "SUCCESS"
                    ? "This transaction is already settled. No action needed."
                    : `This transaction is ${txn.status}. Re-settle only works on FAILED transactions.`}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Settle form */}
      {txn?.status === "FAILED" && (
        <div className="rounded-2xl border border-ink-100 bg-white p-6">
          <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-ink-500">
            2. Provider-verified details
          </h3>
          <p className="mb-4 text-sm text-ink-500">
            Enter the details as confirmed on the Chagans / PG provider dashboard.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label>Verified Status</Label>
              <Select value={verifiedStatus} onChange={(e) => setVerifiedStatus(e.target.value as "PAID" | "FAILED")}>
                <option value="PAID">PAID (SUCCESS on provider)</option>
                <option value="FAILED">FAILED (confirmed failed)</option>
              </Select>
            </div>
            <div>
              <Label>Verified Amount</Label>
              <Input
                type="number"
                placeholder="49998"
                value={verifiedAmount}
                onChange={(e) => setVerifiedAmount(e.target.value)}
              />
            </div>
            <div>
              <Label>Payment Mode</Label>
              <Select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}>
                <option value="CARD">Card</option>
                <option value="UPI">UPI</option>
                <option value="NETBANKING">Netbanking</option>
                <option value="WALLET">Wallet</option>
              </Select>
            </div>
            <div>
              <Label>UTR / Bank Reference</Label>
              <Input
                placeholder="Optional"
                value={utr}
                onChange={(e) => setUtr(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Provider Order ID</Label>
              <Input
                placeholder="CPG_EB9B55401ECB1236"
                value={providerRef}
                onChange={(e) => setProviderRef(e.target.value)}
              />
            </div>
          </div>

          <div className="mt-6 flex items-center gap-4">
            <Button
              onClick={settle}
              disabled={settling || (verifiedStatus === "PAID" && !verifiedAmount)}
              isLoading={settling}
              className="bg-brand-700 hover:bg-brand-800"
            >
              <RefreshCw className="mr-1.5 h-4 w-4" />
              {verifiedStatus === "PAID" ? "Re-settle & Credit Wallet" : "Mark as Failed"}
            </Button>
            <p className="text-xs text-ink-400">
              Requires 2FA. Full audit trail is recorded.
            </p>
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div
          className={`rounded-2xl border p-6 ${
            result.status === "SUCCESS"
              ? "border-accent-200 bg-accent-50"
              : "border-amber-200 bg-amber-50"
          }`}
        >
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-ink-500">Result</h3>
          <div className="flex items-center gap-3">
            <StatusPill status={result.status} />
            {result.amount != null && (
              <span className="text-lg font-bold text-ink-900">{formatINR(result.amount)} credited</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
