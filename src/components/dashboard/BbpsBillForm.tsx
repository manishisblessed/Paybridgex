"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Input, Label, Select } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import {
  TransactionResult,
  type TxnResult,
} from "@/components/dashboard/TransactionResult";
import { TxnPinDialog } from "@/components/security/TxnPinDialog";
import { generateRefId, formatINR } from "@/lib/utils";

/**
 * Live BBPS bill payment — works for any category (electricity, water, gas,
 * education, …). Billers come from /api/services/bbps/billers; when the
 * provider (BulkPe) publishes each biller's required customer params, the
 * form renders those inputs dynamically. Payment is PIN-confirmed and the
 * PIN travels only in the x-txn-pin header.
 */

type BillerParam = { name: string; dataType: string; optional: boolean };
type Biller = { code: string; name: string; params?: BillerParam[] };

type FetchedBill = {
  customerName: string;
  amount: number;
  dueDate?: string;
  billNumber?: string;
  minAmount?: number;
  maxAmount?: number;
  billFetchRef?: string;
};

const FALLBACK_PARAM = "Consumer Number";

export function BbpsBillForm({
  category,
  serviceTitle,
  consumerLabel = "Consumer number",
  refPrefix = "BILL",
}: {
  category: "ELECTRICITY" | "WATER" | "GAS" | "EDUCATION" | "INSURANCE" | "BROADBAND";
  serviceTitle: string;
  consumerLabel?: string;
  refPrefix?: string;
}) {
  type ChargeQuote = {
    serviceCharge: number;
    gst: number;
    totalCharge: number;
    totalDebit: number;
    commission: number;
  };

  const [billers, setBillers] = useState<Biller[]>([]);
  const [billersSource, setBillersSource] = useState("");
  const [billersError, setBillersError] = useState<string | null>(null);
  const [loadingBillers, setLoadingBillers] = useState(true);
  const [billerCode, setBillerCode] = useState("");
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [bill, setBill] = useState<FetchedBill | null>(null);
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<ChargeQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [result, setResult] = useState<TxnResult>(null);

  const loadBillers = useCallback(async () => {
    setLoadingBillers(true);
    setBillersError(null);
    try {
      const res = await fetch(`/api/services/bbps/billers?category=${category}`);
      const data = await res.json();
      if (res.ok && Array.isArray(data.billers) && data.billers.length > 0) {
        setBillers(data.billers);
        setBillersSource(data.source ?? "");
        setBillerCode(data.billers[0].code);
      } else {
        setBillers([]);
        setBillersError(
          typeof data.error === "string" ? data.error : "No billers available for this category yet"
        );
      }
    } catch {
      setBillersError("Could not load billers — check your connection");
    } finally {
      setLoadingBillers(false);
    }
  }, [category]);

  useEffect(() => {
    loadBillers();
  }, [loadBillers]);

  const biller = useMemo(() => billers.find((b) => b.code === billerCode), [billers, billerCode]);

  /** Input fields for the selected biller — its published params, or one generic field. */
  const fields: BillerParam[] = useMemo(() => {
    if (biller?.params && biller.params.length > 0) return biller.params;
    return [{ name: FALLBACK_PARAM, dataType: "ALPHANUMERIC", optional: false }];
  }, [biller]);

  const requiredFilled = fields
    .filter((f) => !f.optional)
    .every((f) => (paramValues[f.name] ?? "").trim().length > 0);

  useEffect(() => {
    const amt = Number(amount);
    if (!amt || amt <= 0) { setQuote(null); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setQuoteLoading(true);
      try {
        const res = await fetch(`/api/services/bbps/quote?amount=${amt}&category=${category}`);
        if (!cancelled && res.ok) {
          const data = await res.json();
          setQuote({
            serviceCharge: data.serviceCharge,
            gst: data.gst,
            totalCharge: data.totalCharge,
            totalDebit: data.totalDebit,
            commission: data.commission,
          });
        }
      } catch { /* swallow */ }
      finally { if (!cancelled) setQuoteLoading(false); }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [amount, category]);

  function resetBill() {
    setBill(null);
    setAmount("");
    setQuote(null);
    setError(null);
  }

  function selectBiller(code: string) {
    setBillerCode(code);
    setParamValues({});
    resetBill();
  }

  /** customerParams sent to fetch/pay: only non-empty values. */
  function customerParams(extra?: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of fields) {
      const v = (paramValues[f.name] ?? "").trim();
      if (v) out[f.name] = v;
    }
    return { ...out, ...extra };
  }

  async function fetchBill() {
    if (!requiredFilled || !billerCode) return;
    setFetching(true);
    setError(null);
    try {
      const res = await fetch("/api/services/bbps/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          billerCode,
          category,
          customerParams: customerParams(),
          idempotencyKey: generateRefId(`${refPrefix}F`),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          typeof data.error === "string"
            ? data.error
            : "Bill fetch failed — verify the details and try again"
        );
        return;
      }
      setBill(data as FetchedBill);
      setAmount("");
    } catch {
      setError("Network error while fetching the bill");
    } finally {
      setFetching(false);
    }
  }

  /** Called by the PIN dialog. Returns an error string to keep it open, null on success. */
  async function payWithPin(pin: string): Promise<string | null> {
    if (!bill) return "No bill loaded";
    setPaying(true);
    try {
      const res = await fetch("/api/services/bbps/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-txn-pin": pin },
        body: JSON.stringify({
          billerCode,
          category,
          customerParams: customerParams(
            bill.billFetchRef ? { billFetchRef: bill.billFetchRef } : undefined
          ),
          amount: Number(amount),
          idempotencyKey: generateRefId(`${refPrefix}P`),
          ...(bill.customerName ? { customerName: bill.customerName } : {}),
          ...(biller?.name ? { billerName: biller.name } : {}),
        }),
      });
      const data = await res.json();
      if (data.status === "FAILED" || (res.status >= 400 && res.status !== 402)) {
        if (data.txnPin) return typeof data.error === "string" ? data.error : "PIN verification failed";
        setPinOpen(false);
        setError(
          typeof data.error === "string"
            ? data.error
            : "Payment failed — any debited amount is auto-refunded to your wallet"
        );
        return null;
      }
      setPinOpen(false);
      const isPending = data.status === "PROCESSING" || res.status === 202;
      setResult({
        refId: data.refId,
        service: `${serviceTitle} — ${biller?.name ?? billerCode}`,
        amount: Number(amount),
        customer: bill.customerName || Object.values(customerParams())[0],
        meta: {
          Biller: biller?.name ?? billerCode,
          ...(data.data?.receipt ? { "Operator ref": data.data.receipt } : {}),
          ...(isPending ? { Status: "Processing — will be confirmed shortly" } : {}),
        },
      });
      resetBill();
      setParamValues({});
      return null;
    } catch {
      setPinOpen(false);
      setError("Network error — check the transaction history before retrying to avoid a duplicate payment");
      return null;
    } finally {
      setPaying(false);
    }
  }

  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!bill || !amount) return;
          const amt = Number(amount);
          const maxAllowed = bill.maxAmount ?? 500000;
          if (amt > maxAllowed) {
            setError(`Amount exceeds the maximum payable limit of ${formatINR(maxAllowed)}`);
            return;
          }
          setError(null);
          setPinOpen(true);
        }}
        className="grid gap-4 rounded-2xl border border-ink-100 bg-white p-6 sm:grid-cols-2"
      >
        <div className="sm:col-span-2">
          <Label htmlFor="biller">Biller / Operator</Label>
          <Select
            id="biller"
            value={billerCode}
            onChange={(e) => selectBiller(e.target.value)}
            disabled={loadingBillers || billers.length === 0}
          >
            {loadingBillers && <option value="">Loading billers…</option>}
            {!loadingBillers && billers.length === 0 && <option value="">No billers available</option>}
            {billers.map((b) => (
              <option key={b.code} value={b.code}>
                {b.name}
              </option>
            ))}
          </Select>
          {billersSource && billersSource !== "CATALOG" && billers.length > 0 && (
            <p className="mt-1 text-[11px] text-ink-400">
              Live BBPS biller list · {billers.length} billers
            </p>
          )}
          {billersError && (
            <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <span>{billersError}</span>
              <button
                type="button"
                onClick={loadBillers}
                className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-amber-900 hover:underline"
              >
                <RefreshCw className="h-3 w-3" /> Retry
              </button>
            </div>
          )}
        </div>

        {fields.map((f) => (
          <div key={f.name} className={fields.length === 1 ? "sm:col-span-2" : undefined}>
            <Label htmlFor={`param-${f.name}`}>
              {f.name === FALLBACK_PARAM ? consumerLabel : f.name}
              {f.optional && <span className="ml-1 text-[11px] font-normal text-ink-400">(optional)</span>}
            </Label>
            <Input
              id={`param-${f.name}`}
              required={!f.optional}
              inputMode={f.dataType === "NUMERIC" ? "numeric" : undefined}
              placeholder={f.dataType === "NUMERIC" ? "Digits only" : "Enter value"}
              value={paramValues[f.name] ?? ""}
              onChange={(e) => {
                const v = f.dataType === "NUMERIC" ? e.target.value.replace(/\D/g, "") : e.target.value;
                setParamValues((p) => ({ ...p, [f.name]: v }));
                resetBill();
              }}
            />
          </div>
        ))}

        {error && (
          <div className="sm:col-span-2 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="sm:col-span-2">
          {!bill ? (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={fetchBill}
              disabled={fetching || !requiredFilled || !billerCode}
              isLoading={fetching}
            >
              Fetch bill
            </Button>
          ) : (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
              {bill.customerName && <p className="font-semibold text-ink-900">{bill.customerName}</p>}
              {bill.dueDate && <p className="text-xs text-ink-600">Bill due {bill.dueDate}</p>}
              <p className="mt-2 font-display text-xl font-bold text-emerald-700">
                {formatINR(bill.amount)}
              </p>
              {bill.minAmount !== undefined && (
                <p className="mt-1 text-xs text-ink-600">
                  Minimum due {formatINR(bill.minAmount)}
                  {bill.maxAmount !== undefined && (
                    <> · Max payable {formatINR(bill.maxAmount)}</>
                  )}
                </p>
              )}
            </div>
          )}
        </div>

        {bill && (
          <>
            <div className="sm:col-span-2">
              <Label htmlFor="amount">Amount to pay (₹)</Label>
              <Input
                id="amount"
                required
                type="number"
                min={1}
                max={bill.maxAmount ?? 500000}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                {bill.minAmount !== undefined && bill.minAmount > 0 && (
                  <button
                    type="button"
                    onClick={() => setAmount(String(bill.minAmount))}
                    className="rounded-full border border-ink-200 px-3 py-1 text-xs font-medium text-ink-700 hover:border-brand-300 hover:text-brand-700"
                  >
                    Minimum due — {formatINR(bill.minAmount)}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setAmount(String(bill.amount))}
                  className="rounded-full border border-ink-200 px-3 py-1 text-xs font-medium text-ink-700 hover:border-brand-300 hover:text-brand-700"
                >
                  Total due — {formatINR(bill.amount)}
                </button>
              </div>
            </div>
            {quote && Number(amount) > 0 && (
              <div className="sm:col-span-2 rounded-xl border border-ink-200 bg-ink-50/50 p-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-ink-600">Bill amount</span>
                  <span className="font-medium text-ink-900">{formatINR(Number(amount))}</span>
                </div>
                <div className="mt-1 flex justify-between">
                  <span className="text-ink-600">Service charge</span>
                  <span className="font-medium text-ink-900">{formatINR(quote.serviceCharge)}</span>
                </div>
                {quote.gst > 0 && (
                  <div className="mt-1 flex justify-between">
                    <span className="text-ink-600">GST (18%)</span>
                    <span className="font-medium text-ink-900">{formatINR(quote.gst)}</span>
                  </div>
                )}
                <hr className="my-2 border-ink-200" />
                <div className="flex justify-between font-semibold">
                  <span className="text-ink-700">Total debit from wallet</span>
                  <span className="text-ink-900">{formatINR(quote.totalDebit)}</span>
                </div>
                {quote.commission > 0 && (
                  <p className="mt-2 text-xs text-emerald-600">
                    Commission earned: {formatINR(quote.commission)} (net of 2% TDS)
                  </p>
                )}
              </div>
            )}
            {quoteLoading && Number(amount) > 0 && (
              <p className="sm:col-span-2 text-center text-xs text-ink-400 animate-pulse">
                Calculating charges…
              </p>
            )}
            <div className="sm:col-span-2">
              <Button type="submit" size="lg" className="w-full" disabled={paying || !amount} isLoading={paying}>
                Pay {quote ? formatINR(quote.totalDebit) : amount ? formatINR(Number(amount)) : "bill"}
              </Button>
              <p className="mt-2 text-center text-[11px] text-ink-400">
                Confirmed with your transaction PIN. Debited from your wallet — failed payments are auto-refunded.
              </p>
            </div>
          </>
        )}
      </form>

      <TxnPinDialog
        open={pinOpen}
        title={`Pay ${serviceTitle.toLowerCase()} bill`}
        detail={biller?.name}
        amount={Number(amount) || undefined}
        busy={paying}
        onConfirm={payWithPin}
        onCancel={() => !paying && setPinOpen(false)}
      />
      <TransactionResult result={result} onClose={() => setResult(null)} />
    </>
  );
}
