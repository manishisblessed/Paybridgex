"use client";

import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { Input, Label, Select } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import {
  TransactionResult,
  type TxnResult
} from "@/components/dashboard/TransactionResult";
import { TxnPinDialog } from "@/components/security/TxnPinDialog";
import { generateRefId, formatINR } from "@/lib/utils";

/**
 * Recharge (mobile / DTH / broadband) against /api/services/recharge —
 * wallet debit + commission + transaction record all happen server-side.
 * Payment is PIN-confirmed; the PIN travels only in the x-txn-pin header.
 */
export function RechargeForm({
  serviceTitle,
  type,
  numberLabel,
  numberPlaceholder,
  operators,
  amountPresets = [99, 199, 299, 399, 499, 999],
  refPrefix = "RCH"
}: {
  serviceTitle: string;
  type: "MOBILE" | "DTH" | "BROADBAND";
  numberLabel: string;
  numberPlaceholder: string;
  operators: string[];
  amountPresets?: number[];
  refPrefix?: string;
}) {
  const [number, setNumber] = useState("");
  const [operator, setOperator] = useState(operators[0]);
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [result, setResult] = useState<TxnResult>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!number || !amount) return;
    setError(null);
    setPinOpen(true);
  }

  /** Called by the PIN dialog. Returns an error string to keep it open, null on success. */
  async function rechargeWithPin(pin: string): Promise<string | null> {
    setLoading(true);
    try {
      const res = await fetch("/api/services/recharge", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-txn-pin": pin },
        body: JSON.stringify({
          type,
          operatorCode: operator,
          number,
          amount: Number(amount),
          idempotencyKey: generateRefId(refPrefix),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.status === "FAILED") {
        // PIN problems stay inside the dialog; other failures surface on the form.
        if (data.txnPin) return typeof data.error === "string" ? data.error : "PIN verification failed";
        setPinOpen(false);
        setError(
          typeof data.error === "string"
            ? data.error
            : "Recharge failed — any debited amount is auto-refunded to your wallet"
        );
        return null;
      }
      setPinOpen(false);
      setResult({
        refId: data.refId,
        service: `${serviceTitle} — ${operator}`,
        amount: Number(amount),
        customer: number,
        meta: { Operator: operator }
      });
      setNumber("");
      setAmount("");
      return null;
    } catch {
      setPinOpen(false);
      setError("Network error — check the transaction history before retrying to avoid a duplicate recharge");
      return null;
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <form
        onSubmit={submit}
        className="grid gap-4 rounded-2xl border border-ink-100 bg-white p-5 shadow-sm sm:grid-cols-2 sm:p-6"
      >
        <div>
          <Label htmlFor="number">{numberLabel}</Label>
          <Input
            id="number"
            required
            placeholder={numberPlaceholder}
            value={number}
            onChange={(e) => setNumber(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="operator">Operator</Label>
          <Select
            id="operator"
            value={operator}
            onChange={(e) => setOperator(e.target.value)}
          >
            {operators.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="amount">Amount (₹)</Label>
          <Input
            id="amount"
            required
            type="number"
            min={1}
            max={10000}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Enter amount"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {amountPresets.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setAmount(String(v))}
                className="rounded-full border border-ink-200 bg-white px-3 py-1 text-xs font-medium text-ink-700 transition-all duration-150 hover:-translate-y-0.5 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 hover:shadow-sm"
              >
                {formatINR(v)}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="sm:col-span-2 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="sm:col-span-2">
          <Button type="submit" size="lg" className="w-full" disabled={loading} isLoading={loading}>
            Pay {amount ? formatINR(Number(amount)) : "now"}
          </Button>
          <p className="mt-2 text-center text-[11px] text-ink-400">
            Confirmed with your transaction PIN. Debited from your wallet — failed recharges are auto-refunded.
          </p>
        </div>
      </form>
      <TxnPinDialog
        open={pinOpen}
        title={serviceTitle}
        detail={`${operator} · ${number}`}
        amount={Number(amount) || undefined}
        busy={loading}
        onConfirm={rechargeWithPin}
        onCancel={() => !loading && setPinOpen(false)}
      />
      <TransactionResult result={result} onClose={() => setResult(null)} />
    </>
  );
}
