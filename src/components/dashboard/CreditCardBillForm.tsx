"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";
import { Input, Label, Select } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import {
  TransactionResult,
  type TxnResult,
} from "@/components/dashboard/TransactionResult";
import { TxnPinDialog } from "@/components/security/TxnPinDialog";
import { generateRefId, formatINR } from "@/lib/utils";

/**
 * Live credit card bill payment via BBPS (Same Day Pay2New).
 * Flow: billers → fetch bill (card last 4 + registered mobile) → pay with
 * the billFetchRef returned by fetch. Amounts and idempotency keys are
 * server-validated; this form only orchestrates the calls.
 */

type Biller = { code: string; name: string };

type FetchedBill = {
  customerName: string;
  amount: number;
  dueDate?: string;
  billNumber?: string;
  minAmount?: number;
  maxAmount?: number;
  billFetchRef?: string;
};

type ChargeQuote = {
  serviceCharge: number;
  gst: number;
  totalCharge: number;
  totalDebit: number;
  commission: number;
};

export function CreditCardBillForm() {
  const [billers, setBillers] = useState<Biller[]>([]);
  const [billersSource, setBillersSource] = useState<string>("");
  const [billerCode, setBillerCode] = useState("");
  const [cardLast4, setCardLast4] = useState("");
  const [mobile, setMobile] = useState("");
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
    try {
      const res = await fetch("/api/services/bbps/billers?category=CREDIT_CARD");
      const data = await res.json();
      if (res.ok && Array.isArray(data.billers)) {
        setBillers(data.billers);
        setBillersSource(data.source ?? "");
        if (data.billers[0]) setBillerCode(data.billers[0].code);
      } else {
        setError(data.error ?? "Could not load billers");
      }
    } catch {
      setError("Could not load billers — check your connection");
    }
  }, []);

  useEffect(() => {
    loadBillers();
  }, [loadBillers]);

  const inputsValid = useMemo(
    () => /^\d{4}$/.test(cardLast4) && /^\d{10}$/.test(mobile) && billerCode,
    [cardLast4, mobile, billerCode]
  );

  useEffect(() => {
    const amt = Number(amount);
    if (!amt || amt <= 0) { setQuote(null); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setQuoteLoading(true);
      try {
        const res = await fetch(`/api/services/bbps/quote?amount=${amt}&category=CREDIT_CARD`);
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
  }, [amount]);

  function resetBill() {
    setBill(null);
    setAmount("");
    setQuote(null);
    setError(null);
  }

  async function fetchBill() {
    if (!inputsValid) return;
    setFetching(true);
    setError(null);
    try {
      const res = await fetch("/api/services/bbps/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          billerCode,
          category: "CREDIT_CARD",
          customerParams: { number: cardLast4, customerNumber: mobile },
          idempotencyKey: generateRefId("CCFETCH"),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Bill fetch failed — verify the card digits and registered mobile");
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

  function pay(e: React.FormEvent) {
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
          category: "CREDIT_CARD",
          customerParams: {
            number: cardLast4,
            customerNumber: mobile,
            ...(bill.billFetchRef ? { billFetchRef: bill.billFetchRef } : {}),
          },
          amount: Number(amount),
          idempotencyKey: generateRefId("CCPAY"),
          ...(bill.customerName ? { customerName: bill.customerName } : {}),
          ...(() => {
            const name = billers.find((b) => b.code === billerCode)?.name;
            return name ? { billerName: name } : {};
          })(),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.status !== "SUCCESS") {
        // PIN problems stay inside the dialog; other failures surface on the form.
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
      setResult({
        refId: data.refId,
        service: `Credit Card Bill — ${billers.find((b) => b.code === billerCode)?.name ?? billerCode}`,
        amount: Number(amount),
        customer: bill.customerName,
        meta: {
          "Card ending": cardLast4,
          ...(data.data?.receipt ? { "Operator ref": data.data.receipt } : {}),
        },
      });
      resetBill();
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
        onSubmit={pay}
        className="grid gap-4 rounded-2xl border border-ink-100 bg-white p-6 sm:grid-cols-2"
      >
        <div className="sm:col-span-2">
          <Label htmlFor="biller">Card issuer</Label>
          <Select
            id="biller"
            value={billerCode}
            onChange={(e) => {
              setBillerCode(e.target.value);
              resetBill();
            }}
          >
            {billers.length === 0 && <option value="">Loading billers…</option>}
            {billers.map((b) => (
              <option key={b.code} value={b.code}>
                {b.name}
              </option>
            ))}
          </Select>
          {billersSource && billersSource !== "CATALOG" && (
            <p className="mt-1 text-[11px] text-ink-400">
              Live biller list · {billers.length} issuers
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="card4">Card number — last 4 digits</Label>
          <Input
            id="card4"
            required
            inputMode="numeric"
            maxLength={4}
            placeholder="e.g. 5008"
            value={cardLast4}
            onChange={(e) => {
              setCardLast4(e.target.value.replace(/\D/g, "").slice(0, 4));
              resetBill();
            }}
          />
        </div>
        <div>
          <Label htmlFor="mobile">Registered mobile number</Label>
          <Input
            id="mobile"
            required
            inputMode="numeric"
            maxLength={10}
            placeholder="10-digit mobile linked to the card"
            value={mobile}
            onChange={(e) => {
              setMobile(e.target.value.replace(/\D/g, "").slice(0, 10));
              resetBill();
            }}
          />
        </div>

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
              disabled={fetching || !inputsValid}
              isLoading={fetching}
            >
              Fetch bill
            </Button>
          ) : (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
              <p className="font-semibold text-ink-900">{bill.customerName}</p>
              {bill.dueDate && (
                <p className="text-xs text-ink-600">Bill due {bill.dueDate}</p>
              )}
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
                {bill.minAmount !== undefined && (
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
        title="Pay credit card bill"
        detail={billers.find((b) => b.code === billerCode)?.name}
        amount={Number(amount) || undefined}
        busy={paying}
        onConfirm={payWithPin}
        onCancel={() => !paying && setPinOpen(false)}
      />
      <TransactionResult result={result} onClose={() => setResult(null)} />
    </>
  );
}
