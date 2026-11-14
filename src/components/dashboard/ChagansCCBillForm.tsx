"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  RefreshCw,
  Loader2,
  CheckCircle2,
  Clock,
  UserPlus,
  ShieldCheck,
} from "lucide-react";
import { Input, Label, Select } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import {
  TransactionResult,
  type TxnResult,
} from "@/components/dashboard/TransactionResult";
import { TxnPinDialog } from "@/components/security/TxnPinDialog";
import { generateRefId, formatINR } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Biller = {
  billerId: string;
  billerName: string;
  // backwards-compat aliases from the operators endpoint
  operatorCode?: string;
  operatorName?: string;
};

type RequiredField = {
  paramName: string;
  dataType: string; // "NUMERIC" | "ALPHA" | "ALPHANUMERIC" | ...
};

type BillerParamsState = {
  requiredFields: RequiredField[];
  billerName: string;
  enquiryId: string;
  fetchedAt: number; // Date.now() — used to detect 30-min expiry
};

type FetchedBill = {
  billerResponse: Record<string, unknown>;
  additionalInfo: Record<string, unknown>;
  message: string;
  dueAmount: number | null;
};

type ChargeQuote = {
  serviceCharge: number;
  gst: number;
  totalCharge: number;
  totalDebit: number;
  commission: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** enquiryId expires after 30 min on Chagans' side — block at 29 min. */
const ENQUIRY_TTL_MS = 29 * 60 * 1000;

/** Build the Zod-positional parameter key from a 0-based index. */
function paramKey(idx: number): string {
  return `param${idx + 1}`;
}

/**
 * Extract a displayable consumer identifier (for the receipt) from the
 * filled parameter values — preferring the first numeric-looking value.
 */
function extractConsumerId(
  fields: RequiredField[],
  values: Record<string, string>
): string {
  for (let i = 0; i < fields.length; i++) {
    const v = values[paramKey(i)] ?? "";
    if (v.length >= 4) return v;
  }
  return "";
}

// ---------------------------------------------------------------------------
// Bill response helper — extract human-readable details from billerResponse
// ---------------------------------------------------------------------------

function extractBillDetails(br: Record<string, unknown>): {
  customerName?: string;
  dueDate?: string;
  minAmount?: number;
  statementBalance?: number;
} {
  const str = (keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = br[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  };
  // Chagans / BBPS returns monetary values in paise — divide by 100 to get ₹.
  const numPaise = (keys: string[]): number | undefined => {
    for (const k of keys) {
      const v = br[k];
      let raw: number | undefined;
      if (typeof v === "number" && Number.isFinite(v) && v > 0) raw = v;
      else if (typeof v === "string" && Number.isFinite(Number(v)) && Number(v) > 0)
        raw = Number(v);
      if (raw !== undefined) return Math.round(raw) / 100;
    }
  };
  return {
    customerName: str(["customerName", "name", "accountName", "billerName"]),
    dueDate: str(["dueDate", "due_date", "billDueDate", "paymentDueDate"]),
    minAmount: numPaise(["minAmount", "minDueAmount", "minimumAmount", "minimumDue"]),
    statementBalance: numPaise(["statementBalance", "totalBalance", "totalOutstanding"]),
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChagansCCBillForm({
  apiBase = "/api/services/chagans-cc",
}: {
  /** Base path for the API routes (e.g. "/api/services/chagans-cc"). */
  apiBase?: string;
} = {}) {
  // --- Step 1: Billers ---
  const [billers, setBillers] = useState<Biller[]>([]);
  const [billerId, setBillerId] = useState("");
  const [billerName, setBillerName] = useState("");
  const [loadingBillers, setLoadingBillers] = useState(true);

  // --- Step 2: Biller params ---
  const [billerParams, setBillerParams] = useState<BillerParamsState | null>(null);
  const [loadingParams, setLoadingParams] = useState(false);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});

  // --- Step 3: Fetched bill ---
  const [fetchedBill, setFetchedBill] = useState<FetchedBill | null>(null);
  const [fetching, setFetching] = useState(false);

  // --- Step 4: Pay ---
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<ChargeQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);

  // --- Shared ---
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);
  const [processingRefId, setProcessingRefId] = useState<string | null>(null);
  const [result, setResult] = useState<TxnResult>(null);

  // --- Merchant onboarding ---
  const [canTransact, setCanTransact] = useState<boolean | null>(null);
  const [merchantStatus, setMerchantStatus] = useState<string | null>(null);

  // --- Status Check ---
  const [statusRefId, setStatusRefId] = useState<string>("");
  const [statusChecking, setStatusChecking] = useState(false);
  const [statusResult, setStatusResult] = useState<{
    orderId: string;
    status: string;
    amount: number | null;
    message: string | null;
  } | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Step 1 — load billers
  // ---------------------------------------------------------------------------

  const loadBillers = useCallback(async (refresh = false) => {
    setLoadingBillers(true);
    try {
      const url = `${apiBase}/operators${refresh ? "?refresh=true" : ""}`;
      const res = await fetch(url);
      const data = await res.json();

      // Merchant onboarding status from the operators response.
      if (typeof data.canTransact === "boolean") {
        setCanTransact(data.canTransact);
      }
      if (data.merchant?.status) {
        setMerchantStatus(data.merchant.status);
      }

      if (res.ok && Array.isArray(data.operators)) {
        const list: Biller[] = data.operators.map(
          (o: { billerId?: string; operatorCode?: string; billerName?: string; operatorName?: string }) => ({
            billerId: o.billerId ?? o.operatorCode ?? "",
            billerName: o.billerName ?? o.operatorName ?? "",
          })
        );
        setBillers(list);
      } else if (data.canTransact === false) {
        // User needs to onboard — no error, the gate UI will show instead.
      } else {
        // Do not expose raw provider error messages to users.
        setError("Could not load card issuers — please tap the refresh button to try again");
      }
    } catch {
      setError("Could not load card issuers — check your connection and refresh");
    } finally {
      setLoadingBillers(false);
    }
  }, [apiBase]);

  useEffect(() => {
    loadBillers();
  }, [loadBillers]);

  // ---------------------------------------------------------------------------
  // Step 2 — load biller params whenever billerId changes
  // ---------------------------------------------------------------------------

  const loadBillerParams = useCallback(
    async (id: string, name: string) => {
      if (!id) return;
      setLoadingParams(true);
      setBillerParams(null);
      setParamValues({});
      setFetchedBill(null);
      setAmount("");
      setQuote(null);
      setError(null);
      try {
        const res = await fetch(`${apiBase}/billers-params`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ billerId: id }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError("Could not load biller details — please re-select the card issuer or try again");
          return;
        }
        // Initialise paramValues with empty strings for each required field.
        const init: Record<string, string> = {};
        (data.requiredFields as RequiredField[]).forEach((_, i) => {
          init[paramKey(i)] = "";
        });
        setBillerParams({
          requiredFields: data.requiredFields,
          billerName: data.billerName || name,
          enquiryId: data.enquiryId,
          fetchedAt: data.enquiryFetchedAt ?? Date.now(),
        });
        setParamValues(init);
      } catch {
        setError("Could not load biller fields — check your connection");
      } finally {
        setLoadingParams(false);
      }
    },
    [apiBase]
  );

  // Auto-load params when biller selection changes.
  useEffect(() => {
    if (billerId) {
      const name = billers.find((b) => b.billerId === billerId)?.billerName ?? "";
      loadBillerParams(billerId, name);
    }
  }, [billerId, billers, loadBillerParams]);

  // ---------------------------------------------------------------------------
  // enquiryId expiry check
  // ---------------------------------------------------------------------------

  const enquiryExpired = useMemo(() => {
    if (!billerParams) return false;
    return Date.now() - billerParams.fetchedAt >= ENQUIRY_TTL_MS;
  }, [billerParams]);

  const enquiryRemainingMin = useMemo(() => {
    if (!billerParams) return 0;
    const elapsed = Date.now() - billerParams.fetchedAt;
    return Math.max(0, Math.floor((ENQUIRY_TTL_MS - elapsed) / 60_000));
  }, [billerParams]);

  // ---------------------------------------------------------------------------
  // Step 2 validation — all required param fields filled
  // ---------------------------------------------------------------------------

  const paramsValid = useMemo(() => {
    if (!billerParams || billerParams.requiredFields.length === 0) return false;
    return billerParams.requiredFields.every((_, i) => {
      const v = paramValues[paramKey(i)] ?? "";
      return v.trim().length > 0;
    });
  }, [billerParams, paramValues]);

  // ---------------------------------------------------------------------------
  // Step 3 — fetch bill
  // ---------------------------------------------------------------------------

  async function handleFetchBill() {
    if (!billerParams || !paramsValid) return;
    setError(null);

    // If the enquiryId expired, re-fetch params before proceeding.
    if (enquiryExpired) {
      await loadBillerParams(billerId, billerName);
      setError("Session expired — biller fields refreshed. Please click 'Fetch Bill' again.");
      return;
    }

    setFetching(true);
    setFetchedBill(null);
    setAmount("");
    setQuote(null);

    try {
      const res = await fetch(`${apiBase}/fetch-bill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          billerId,
          enquiryId: billerParams.enquiryId,
          parameters: paramValues,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Map common provider error codes to user-friendly messages; do not
        // expose raw Chagans error strings to the user.
        const msg =
          data.code === "INVALID_PARAMS" || data.code === "CHAGAN_CC_INVALID_PARAMS"
            ? "Could not find this account — check the details you entered and try again"
            : data.code === "TIMEOUT" || data.code === "NETWORK"
              ? "Connection timed out — please try again"
              : "Bill details could not be fetched — check the information and try again";
        setError(msg);
        return;
      }
      setFetchedBill(data as FetchedBill);
      // Do NOT auto-fill amount — let the user decide how much to pay.
      // Quick-fill buttons ("Total due", "Min due") are shown below the
      // amount input for convenience.
    } catch {
      setError("Network error while fetching the bill — please retry");
    } finally {
      setFetching(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Charge quote — debounced on amount change
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setQuoteLoading(true);
      try {
        const res = await fetch(`${apiBase}/charges`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount: amt }),
        });
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
      } catch {
        /* swallow — charge preview is best-effort */
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [amount]);

  // ---------------------------------------------------------------------------
  // Step 4 — pay
  // ---------------------------------------------------------------------------

  function handlePaySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fetchedBill || !amount || Number(amount) <= 0) return;
    if (enquiryExpired) {
      setError("Session expired (30 min). Please re-fetch the bill before paying.");
      return;
    }
    setError(null);
    setProcessing(null);
    setPinOpen(true);
  }

  async function payWithPin(pin: string): Promise<string | null> {
    if (!billerParams) return "Session lost — please reload the page";
    if (enquiryExpired) {
      setPinOpen(false);
      setError("Session expired. Please re-fetch the bill before paying.");
      return null;
    }
    setPaying(true);
    try {
      const res = await fetch(`${apiBase}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-txn-pin": pin },
        body: JSON.stringify({
          billerId,
          billerName: billerParams.billerName || billerName,
          enquiryId: billerParams.enquiryId,
          parameters: paramValues,
          amount: Number(amount),
          idempotencyKey: generateRefId("CGCC"),
        }),
      });
      const data = await res.json();

      // PIN errors — keep dialog open.
      if (data.txnPin) {
        return typeof data.error === "string"
          ? data.error
          : "PIN verification failed";
      }

      // Async-pending (PROCESSING / 202).
      if (data.status === "PROCESSING" || data.status === "INITIATED") {
        setPinOpen(false);
        setProcessingRefId(data.refId ?? null);
        setProcessing(
          "Payment is being processed — do NOT re-submit. Use the button below to check the final status."
        );
        resetAfterPay();
        return null;
      }

      if (!res.ok || data.status !== "SUCCESS") {
        setPinOpen(false);
        if (data.code === "INSUFFICIENT_BALANCE") {
          setError(
            `Insufficient wallet balance. Required: ${formatINR(data.required_amount ?? 0)}, Available: ${formatINR(data.wallet_balance ?? 0)}`
          );
        } else {
          setError(
            typeof data.error === "string"
              ? data.error
              : "Payment failed — any debited amount is auto-refunded to your wallet"
          );
        }
        return null;
      }

      // SUCCESS
      setPinOpen(false);
      const consumerId = extractConsumerId(billerParams.requiredFields, paramValues);
      setResult({
        refId: data.refId,
        service: `CC Bill Payment — ${billerParams.billerName || billerName}`,
        amount: Number(amount),
        customer: consumerId || billerName,
        meta: {
          ...(consumerId ? { "Consumer ID": consumerId } : {}),
          ...(data.data?.transactionId
            ? { "Provider Txn ID": data.data.transactionId }
            : {}),
        },
      });
      resetAfterPay();
      return null;
    } catch {
      setPinOpen(false);
      setError(
        "Network error — check your transaction history before retrying to avoid a duplicate payment."
      );
      return null;
    } finally {
      setPaying(false);
    }
  }

  function resetAfterPay() {
    setFetchedBill(null);
    setAmount("");
    setQuote(null);
    // Reset param values but keep biller selection + params loaded.
    if (billerParams) {
      const init: Record<string, string> = {};
      billerParams.requiredFields.forEach((_, i) => {
        init[paramKey(i)] = "";
      });
      setParamValues(init);
    }
    setError(null);
  }

  function handleBillerChange(newId: string) {
    const found = billers.find((b) => b.billerId === newId);
    setBillerId(newId);
    setBillerName(found?.billerName ?? "");
    // Params + bill reset is handled by the useEffect on billerId change.
  }

  // ---------------------------------------------------------------------------
  // Derived display helpers
  // ---------------------------------------------------------------------------

  const selectedBiller = billers.find((b) => b.billerId === billerId);
  const billDetails = fetchedBill
    ? extractBillDetails(fetchedBill.billerResponse)
    : null;
  const amtNum = Number(amount);
  const rawMax = fetchedBill?.billerResponse?.maxAmount;
  const maxAmount =
    typeof rawMax === "number" && rawMax > 0
      ? Math.round(rawMax) / 100 // paise → ₹
      : 500000;

  // ---------------------------------------------------------------------------
  // Status check handler
  // ---------------------------------------------------------------------------
  const handleCheckStatus = useCallback(
    async (refIdOverride?: string) => {
      const id = refIdOverride || statusRefId.trim();
      if (!id) return;
      setStatusChecking(true);
      setStatusError(null);
      setStatusResult(null);
      try {
        const res = await fetch(`${apiBase}/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refId: id }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          setStatusError(data.message || "Status check failed");
          return;
        }
        setStatusResult(data.data);

        // If the transaction has reached a final state, clear the
        // processing banner so only the result card is visible.
        const finalStatus = data.data?.status;
        if (finalStatus === "SUCCESS" || finalStatus === "FAILED" || finalStatus === "REFUNDED") {
          setProcessing(null);
          setProcessingRefId(null);
        }
      } catch {
        setStatusError("Network error while checking status");
      } finally {
        setStatusChecking(false);
      }
    },
    [statusRefId, apiBase]
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // Show merchant onboarding gate if the user can't transact yet
  if (canTransact === false) {
    return (
      <MerchantOnboardingGate
        status={merchantStatus}
        apiBase={apiBase}
        onSuccess={() => {
          setCanTransact(true);
          setMerchantStatus("ACTIVE");
          loadBillers();
        }}
      />
    );
  }

  return (
    <>
      <form
        onSubmit={handlePaySubmit}
        className="grid gap-4 rounded-2xl border border-ink-100 bg-white p-6 sm:grid-cols-2"
      >
        {/* ── Step 1: Biller selection ── */}
        <div className="sm:col-span-2">
          <Label htmlFor="biller">Card issuer / Bank</Label>
          <div className="flex gap-2">
            <div className="flex-1">
              <Select
                id="biller"
                value={billerId}
                onChange={(e) => handleBillerChange(e.target.value)}
                disabled={loadingBillers || loadingParams}
              >
                {loadingBillers ? (
                  <option value="">Loading billers…</option>
                ) : billers.length === 0 ? (
                  <option value="">No billers found</option>
                ) : (
                  <>
                    <option value="">Select card issuer</option>
                    {billers.map((b) => (
                      <option key={b.billerId} value={b.billerId}>
                        {b.billerName}
                      </option>
                    ))}
                  </>
                )}
              </Select>
            </div>
            <button
              type="button"
              onClick={() => loadBillers(true)}
              disabled={loadingBillers || loadingParams}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-ink-200 text-ink-500 transition hover:bg-ink-50 hover:text-ink-700 disabled:opacity-50"
              title="Refresh biller list"
            >
              <RefreshCw
                className={`h-4 w-4 ${loadingBillers ? "animate-spin" : ""}`}
              />
            </button>
          </div>
          {!loadingBillers && billers.length > 0 && (
            <p className="mt-1 text-[11px] text-ink-400">
              {billers.length} billers available
            </p>
          )}
        </div>

        {/* ── Step 2: Dynamic biller fields ── */}
        {loadingParams && (
          <div className="sm:col-span-2 flex items-center gap-2 text-sm text-ink-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading biller fields…
          </div>
        )}

        {billerParams && !loadingParams && (
          <>
            {billerParams.requiredFields.length === 0 ? (
              /* Fallback: biller returned no fields — manual entry not possible */
              <p className="sm:col-span-2 text-sm text-amber-600">
                This biller did not return input field definitions. Please
                select a different biller or contact support.
              </p>
            ) : (
              billerParams.requiredFields.map((field, idx) => (
                <div
                  key={idx}
                  className={
                    billerParams.requiredFields.length === 1
                      ? "sm:col-span-2"
                      : ""
                  }
                >
                  <Label htmlFor={`param-${idx}`}>{field.paramName}</Label>
                  <Input
                    id={`param-${idx}`}
                    required
                    inputMode={
                      field.dataType === "NUMERIC" ? "numeric" : "text"
                    }
                    placeholder={
                      field.dataType === "NUMERIC"
                        ? `Enter ${field.paramName} (numbers only)`
                        : `Enter ${field.paramName}`
                    }
                    value={paramValues[paramKey(idx)] ?? ""}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const val =
                        field.dataType === "NUMERIC"
                          ? raw.replace(/\D/g, "")
                          : raw;
                      setParamValues((prev) => ({
                        ...prev,
                        [paramKey(idx)]: val,
                      }));
                      // Reset bill when params change.
                      if (fetchedBill) {
                        setFetchedBill(null);
                        setAmount("");
                        setQuote(null);
                      }
                    }}
                  />
                </div>
              ))
            )}

            {/* enquiryId expiry indicator */}
            {!enquiryExpired && billerParams.requiredFields.length > 0 && (
              <p className="sm:col-span-2 flex items-center gap-1 text-[11px] text-ink-400">
                <Clock className="h-3 w-3" />
                Session valid for ~{enquiryRemainingMin} more min
              </p>
            )}
            {enquiryExpired && (
              <div className="sm:col-span-2 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Session expired. Select the biller again or click the refresh
                  button to start a new session.
                </span>
              </div>
            )}

            {/* Fetch Bill button */}
            {billerParams.requiredFields.length > 0 && !fetchedBill && (
              <div className="sm:col-span-2">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={handleFetchBill}
                  disabled={
                    fetching || !paramsValid || enquiryExpired || loadingParams
                  }
                  isLoading={fetching}
                >
                  Fetch bill
                </Button>
              </div>
            )}
          </>
        )}

        {/* ── Step 3: Bill details ── */}
        {fetchedBill && (
          <div className="sm:col-span-2">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                <p className="font-semibold text-ink-900">
                  {billDetails?.customerName ??
                    selectedBiller?.billerName ??
                    "Bill fetched"}
                </p>
              </div>
              {billDetails?.dueDate && (
                <p className="mt-1 text-xs text-ink-600">
                  Due date: {billDetails.dueDate}
                </p>
              )}
              {fetchedBill.dueAmount && fetchedBill.dueAmount > 0 ? (
                <p className="mt-2 font-display text-xl font-bold text-emerald-700">
                  {formatINR(fetchedBill.dueAmount)}
                </p>
              ) : (
                <p className="mt-2 text-xs text-ink-500">
                  {fetchedBill.message || "Bill details retrieved — enter the amount below"}
                </p>
              )}
              {billDetails?.minAmount !== undefined && (
                <p className="mt-1 text-xs text-ink-600">
                  Minimum due: {formatINR(billDetails.minAmount)}
                  {billDetails.statementBalance !== undefined && (
                    <> · Statement balance: {formatINR(billDetails.statementBalance)}</>
                  )}
                </p>
              )}
            </div>
            {/* Re-fetch option */}
            <button
              type="button"
              onClick={() => {
                setFetchedBill(null);
                setAmount("");
                setQuote(null);
                setError(null);
              }}
              className="mt-2 text-xs text-ink-400 underline underline-offset-2 hover:text-ink-600"
            >
              Re-fetch bill
            </button>
          </div>
        )}

        {/* ── Step 4: Amount + charges ── */}
        {fetchedBill && (
          <>
            <div className="sm:col-span-2">
              <Label htmlFor="amount">Amount to pay (₹)</Label>
              <Input
                id="amount"
                required
                type="number"
                min={1}
                max={maxAmount}
                placeholder="Enter amount in rupees"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              {/* Quick-fill buttons */}
              {(fetchedBill.dueAmount || billDetails?.minAmount) && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {billDetails?.minAmount !== undefined && (
                    <button
                      type="button"
                      onClick={() => setAmount(String(billDetails.minAmount))}
                      className="rounded-full border border-ink-200 px-3 py-1 text-xs font-medium text-ink-700 hover:border-brand-300 hover:text-brand-700"
                    >
                      Min due — {formatINR(billDetails.minAmount!)}
                    </button>
                  )}
                  {fetchedBill.dueAmount && fetchedBill.dueAmount > 0 && (
                    <button
                      type="button"
                      onClick={() => setAmount(String(fetchedBill.dueAmount))}
                      className="rounded-full border border-ink-200 px-3 py-1 text-xs font-medium text-ink-700 hover:border-brand-300 hover:text-brand-700"
                    >
                      Total due — {formatINR(fetchedBill.dueAmount)}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Charge preview */}
            {quote && amtNum > 0 && (
              <div className="sm:col-span-2 rounded-xl border border-ink-200 bg-ink-50/50 p-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-ink-600">Bill amount</span>
                  <span className="font-medium text-ink-900">
                    {formatINR(amtNum)}
                  </span>
                </div>
                <div className="mt-1 flex justify-between">
                  <span className="text-ink-600">Service charge</span>
                  <span className="font-medium text-ink-900">
                    {formatINR(quote.serviceCharge)}
                  </span>
                </div>
                {quote.gst > 0 && (
                  <div className="mt-1 flex justify-between">
                    <span className="text-ink-600">GST (18%)</span>
                    <span className="font-medium text-ink-900">
                      {formatINR(quote.gst)}
                    </span>
                  </div>
                )}
                <hr className="my-2 border-ink-200" />
                <div className="flex justify-between font-semibold">
                  <span className="text-ink-700">Total debit from wallet</span>
                  <span className="text-ink-900">
                    {formatINR(quote.totalDebit)}
                  </span>
                </div>
                {quote.commission > 0 && (
                  <p className="mt-2 text-xs text-emerald-600">
                    Commission earned: {formatINR(quote.commission)} (net of 2% TDS)
                  </p>
                )}
              </div>
            )}
            {quoteLoading && amtNum > 0 && (
              <p className="sm:col-span-2 text-center text-xs text-ink-400 animate-pulse">
                Calculating charges…
              </p>
            )}
          </>
        )}

        {/* ── Error ── */}
        {error && (
          <div className="sm:col-span-2 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ── Processing notice + inline status check for pending payment ── */}
        {processing && (
          <div className="sm:col-span-2 space-y-3">
            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              <span>{processing}</span>
            </div>
            {processingRefId && (
              <div className="rounded-xl border border-ink-200 bg-ink-50/50 p-4">
                <p className="mb-2 text-xs font-medium text-ink-600">
                  Ref ID: <span className="font-mono">{processingRefId}</span>
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  disabled={statusChecking}
                  isLoading={statusChecking}
                  onClick={() => {
                    setStatusRefId(processingRefId);
                    handleCheckStatus(processingRefId);
                  }}
                >
                  Check Transaction Status
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ── Submit ── */}
        {fetchedBill && (
          <div className="sm:col-span-2">
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={paying || !amtNum || amtNum <= 0 || enquiryExpired}
              isLoading={paying}
            >
              Pay{" "}
              {quote
                ? formatINR(quote.totalDebit)
                : amtNum
                  ? formatINR(amtNum)
                  : "bill"}
            </Button>
            <p className="mt-2 text-center text-[11px] text-ink-400">
              Confirmed with your transaction PIN. Debited from your wallet —
              failed payments are auto-refunded.
            </p>
          </div>
        )}
      </form>

      <TxnPinDialog
        open={pinOpen}
        title="Pay credit card bill"
        detail={`${billerParams?.billerName ?? billerName}${
          amount ? ` · ${formatINR(Number(amount))}` : ""
        }`}
        amount={amtNum || undefined}
        busy={paying}
        onConfirm={payWithPin}
        onCancel={() => !paying && setPinOpen(false)}
      />
      <TransactionResult result={result} onClose={() => setResult(null)} />

      {/* ── Status result card — shown after a status check returns ── */}
      {statusResult && (
        <div className="mt-6 rounded-xl border border-ink-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink-700">
              Transaction Status
            </h3>
            <button
              type="button"
              onClick={() => {
                setStatusResult(null);
                setStatusError(null);
                setStatusRefId("");
              }}
              className="text-xs text-ink-400 underline underline-offset-2 hover:text-ink-600"
            >
              Dismiss
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <span className="text-ink-500">Status:</span>
            <span
              className={`font-semibold ${
                statusResult.status === "SUCCESS"
                  ? "text-emerald-600"
                  : statusResult.status === "FAILED"
                    ? "text-rose-600"
                    : statusResult.status === "REFUNDED"
                      ? "text-orange-600"
                      : "text-amber-600"
              }`}
            >
              {statusResult.status}
            </span>
            <span className="text-ink-500">Order ID:</span>
            <span className="font-mono text-xs text-ink-900">{statusResult.orderId}</span>
            {statusResult.amount != null && (
              <>
                <span className="text-ink-500">Amount:</span>
                <span className="text-ink-900">{formatINR(statusResult.amount)}</span>
              </>
            )}
            {statusResult.message && (
              <>
                <span className="text-ink-500">Message:</span>
                <span className="text-ink-900">{statusResult.message}</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Status error ── */}
      {statusError && !statusResult && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{statusError}</span>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Merchant Onboarding Gate — shown when canTransact is false
// ---------------------------------------------------------------------------

function MerchantOnboardingGate({
  status,
  apiBase,
  onSuccess,
}: {
  status: string | null;
  apiBase: string;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    name: "",
    mobile: "",
    email: "",
    gender: "M",
    pan: "",
    aadhaar: "",
    dateOfBirth: "",
    bankAccountNo: "",
    bankIfsc: "",
    addressFull: "",
    city: "",
    pincode: "",
    latitude: "",
    longitude: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Auto-fill lat/long from browser
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setForm((f) => ({
            ...f,
            latitude: String(pos.coords.latitude.toFixed(6)),
            longitude: String(pos.coords.longitude.toFixed(6)),
          }));
        },
        () => {
          // Geolocation denied — user will fill manually or we use defaults
          setForm((f) => ({
            ...f,
            latitude: f.latitude || "28.6139",
            longitude: f.longitude || "77.2090",
          }));
        }
      );
    }
  }, []);

  const update = (key: string, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setError(null);
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch(`${apiBase}/merchant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          mobile: form.mobile.trim(),
          email: form.email.trim(),
          gender: form.gender,
          pan: form.pan.trim().toUpperCase(),
          aadhaar: form.aadhaar.trim(),
          dateOfBirth: form.dateOfBirth,
          bankAccountNo: form.bankAccountNo.trim(),
          bankIfsc: form.bankIfsc.trim().toUpperCase(),
          latitude: form.latitude || "28.6139",
          longitude: form.longitude || "77.2090",
          address: {
            full: form.addressFull.trim(),
            city: form.city.trim(),
            pincode: form.pincode.trim(),
          },
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        // Parse Zod validation errors
        if (data.error?.fieldErrors) {
          const fields = data.error.fieldErrors as Record<string, string[]>;
          const msgs = Object.entries(fields)
            .map(([k, v]) => `${k}: ${(v as string[]).join(", ")}`)
            .join(" · ");
          setError(msgs);
        } else {
          setError(
            typeof data.error === "string"
              ? data.error
              : "Onboarding failed — please check your details"
          );
        }
        return;
      }

      setSuccess(true);
      setTimeout(onSuccess, 1500);
    } catch {
      setError("Network error — please check your connection");
    } finally {
      setSubmitting(false);
    }
  }

  // Pending / Rejected / Suspended states
  if (status === "PENDING") {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center">
        <Clock className="mx-auto mb-3 h-10 w-10 text-amber-500" />
        <h3 className="text-lg font-bold text-ink-900">
          Merchant Onboarding Pending
        </h3>
        <p className="mt-2 text-sm text-ink-600">
          Your merchant KYC verification is in progress. Please wait for approval
          before you can use CC Bill Payment.
        </p>
      </div>
    );
  }

  if (status === "SUSPENDED") {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center">
        <AlertCircle className="mx-auto mb-3 h-10 w-10 text-red-500" />
        <h3 className="text-lg font-bold text-ink-900">
          Merchant Account Suspended
        </h3>
        <p className="mt-2 text-sm text-ink-600">
          Your merchant account has been suspended. Please contact your
          administrator for assistance.
        </p>
      </div>
    );
  }

  if (success) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center">
        <ShieldCheck className="mx-auto mb-3 h-10 w-10 text-emerald-500" />
        <h3 className="text-lg font-bold text-ink-900">
          Merchant Onboarding Complete!
        </h3>
        <p className="mt-2 text-sm text-ink-600">
          Your KYC has been approved. Redirecting to CC Bill Payment...
        </p>
      </div>
    );
  }

  const inputCls =
    "w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-6">
      <div className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow">
          <UserPlus className="h-5 w-5" />
        </span>
        <div>
          <h3 className="font-display text-lg font-bold text-ink-900">
            Merchant Onboarding
          </h3>
          <p className="text-xs text-ink-500">
            Complete your KYC to start making CC Bill Payments
          </p>
        </div>
      </div>

      {status === "REJECTED" && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="mr-1.5 inline h-4 w-4 -translate-y-0.5" />
          Your previous onboarding was rejected. Please re-submit with correct details.
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="mr-1.5 inline h-4 w-4 -translate-y-0.5" />
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="onb-name">Full Name *</Label>
          <input
            id="onb-name"
            className={inputCls}
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder="As per PAN card"
            required
          />
        </div>

        <div>
          <Label htmlFor="onb-mobile">Mobile *</Label>
          <input
            id="onb-mobile"
            className={inputCls}
            value={form.mobile}
            onChange={(e) => update("mobile", e.target.value.replace(/\D/g, "").slice(0, 10))}
            placeholder="10-digit mobile"
            maxLength={10}
            required
          />
        </div>

        <div>
          <Label htmlFor="onb-email">Email *</Label>
          <input
            id="onb-email"
            className={inputCls}
            type="email"
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            placeholder="you@example.com"
            required
          />
        </div>

        <div>
          <Label htmlFor="onb-gender">Gender *</Label>
          <select
            id="onb-gender"
            className={inputCls}
            value={form.gender}
            onChange={(e) => update("gender", e.target.value)}
          >
            <option value="M">Male</option>
            <option value="F">Female</option>
            <option value="O">Other</option>
          </select>
        </div>

        <div>
          <Label htmlFor="onb-pan">PAN *</Label>
          <input
            id="onb-pan"
            className={inputCls}
            value={form.pan}
            onChange={(e) => update("pan", e.target.value.toUpperCase().slice(0, 10))}
            placeholder="ABCDE1234F"
            maxLength={10}
            required
          />
        </div>

        <div>
          <Label htmlFor="onb-aadhaar">Aadhaar *</Label>
          <input
            id="onb-aadhaar"
            className={inputCls}
            value={form.aadhaar}
            onChange={(e) => update("aadhaar", e.target.value.replace(/\D/g, "").slice(0, 12))}
            placeholder="12-digit Aadhaar"
            maxLength={12}
            required
          />
        </div>

        <div>
          <Label htmlFor="onb-dob">Date of Birth *</Label>
          <input
            id="onb-dob"
            className={inputCls}
            type="date"
            value={form.dateOfBirth}
            onChange={(e) => update("dateOfBirth", e.target.value)}
            required
          />
        </div>

        <div>
          <Label htmlFor="onb-bank">Bank Account No. *</Label>
          <input
            id="onb-bank"
            className={inputCls}
            value={form.bankAccountNo}
            onChange={(e) => update("bankAccountNo", e.target.value.replace(/\D/g, "").slice(0, 20))}
            placeholder="Account number"
            maxLength={20}
            required
          />
        </div>

        <div>
          <Label htmlFor="onb-ifsc">IFSC Code *</Label>
          <input
            id="onb-ifsc"
            className={inputCls}
            value={form.bankIfsc}
            onChange={(e) => update("bankIfsc", e.target.value.toUpperCase().slice(0, 11))}
            placeholder="SBIN0001234"
            maxLength={11}
            required
          />
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="onb-address">Full Address *</Label>
          <input
            id="onb-address"
            className={inputCls}
            value={form.addressFull}
            onChange={(e) => update("addressFull", e.target.value)}
            placeholder="Shop / office address"
            required
          />
        </div>

        <div>
          <Label htmlFor="onb-city">City *</Label>
          <input
            id="onb-city"
            className={inputCls}
            value={form.city}
            onChange={(e) => update("city", e.target.value)}
            placeholder="City"
            required
          />
        </div>

        <div>
          <Label htmlFor="onb-pincode">Pincode *</Label>
          <input
            id="onb-pincode"
            className={inputCls}
            value={form.pincode}
            onChange={(e) => update("pincode", e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="6-digit pincode"
            maxLength={6}
            required
          />
        </div>

        <div className="sm:col-span-2">
          <Button
            type="submit"
            variant="primary"
            disabled={submitting}
            className="w-full"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Verifying KYC...
              </>
            ) : (
              <>
                <UserPlus className="mr-2 h-4 w-4" />
                Complete Merchant Onboarding
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
