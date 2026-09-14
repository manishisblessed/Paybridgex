"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, KeyRound, Lock, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { PinInput } from "./PinInput";
import { formatINR, formatIST } from "@/lib/utils";

/**
 * Transaction-PIN confirmation sheet, shown at the moment of payment on
 * every money-moving action. The parent owns submission: `onConfirm(pin)`
 * performs the API call (sending the pin via the `x-txn-pin` header) and
 * throws / returns an error message when the server rejects it.
 *
 * Handles the three server states for you:
 *  - PIN not set   → setup call-to-action linking to /dashboard/settings/txn-pin
 *  - PIN locked    → cool-down message
 *  - wrong PIN     → inline error + cleared boxes
 */
export function TxnPinDialog({
  open,
  title = "Confirm payment",
  detail,
  amount,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title?: string;
  detail?: string;
  amount?: number;
  busy?: boolean;
  /** Perform the payment. Return an error message to keep the dialog open, or null on success. */
  onConfirm: (pin: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pinState, setPinState] = useState<"unknown" | "ready" | "not-set" | "locked">("unknown");
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/security/txn-pin");
      const data = await res.json();
      if (!res.ok) {
        setPinState("ready"); // fail open to the entry UI; the server still enforces
        return;
      }
      if (!data.isSet) setPinState("not-set");
      else if (data.lockedUntil && new Date(data.lockedUntil) > new Date()) {
        setLockedUntil(data.lockedUntil);
        setPinState("locked");
      } else setPinState("ready");
    } catch {
      setPinState("ready");
    }
  }, []);

  useEffect(() => {
    if (open) {
      setPin("");
      setError(null);
      setPinState("unknown");
      checkStatus();
    }
  }, [open, checkStatus]);

  async function submit(fullPin: string) {
    if (busy) return;
    setError(null);
    const err = await onConfirm(fullPin);
    if (err) {
      setError(err);
      setPin("");
      // Re-check: the failure may have locked the PIN.
      if (/locked/i.test(err)) checkStatus();
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink-900/50 px-4 py-8 backdrop-blur"
      role="dialog"
      aria-modal
      aria-label={title}
    >
      <div className="relative w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-glow">
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel"
          disabled={busy}
          className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full bg-ink-100 text-ink-700 hover:bg-ink-200 disabled:opacity-50"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="px-6 pb-6 pt-8 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-700">
            <ShieldCheck className="h-7 w-7" />
          </span>
          <h2 className="mt-4 font-display text-lg font-bold text-ink-900">{title}</h2>
          {amount !== undefined && (
            <p className="mt-1 font-display text-3xl font-bold text-ink-900">{formatINR(amount)}</p>
          )}
          {detail && <p className="mt-1 text-sm text-ink-500">{detail}</p>}
        </div>

        <div className="border-t border-ink-100 bg-ink-50/50 px-6 py-6">
          {pinState === "unknown" && (
            <p className="text-center text-sm text-ink-500">Checking PIN status…</p>
          )}

          {pinState === "not-set" && (
            <div className="space-y-4 text-center">
              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-left text-sm text-amber-800">
                <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  You haven&apos;t set a transaction PIN yet. Every payment requires
                  one — set it once and use it for all transactions.
                </span>
              </div>
              <Link href="/dashboard/settings/txn-pin">
                <Button type="button" className="w-full">Set up transaction PIN</Button>
              </Link>
            </div>
          )}

          {pinState === "locked" && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              <Lock className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                PIN entry is locked after too many wrong attempts.
                {lockedUntil && (
                  <> Try again after {formatIST(lockedUntil, { hour: "2-digit", minute: "2-digit" })}.</>
                )}
              </span>
            </div>
          )}

          {pinState === "ready" && (
            <div className="space-y-4">
              <p className="text-center text-xs font-semibold uppercase tracking-widest text-ink-500">
                Enter your transaction PIN
              </p>
              <PinInput value={pin} onChange={setPin} onComplete={submit} disabled={busy} />
              {error && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <Button
                type="button"
                className="w-full"
                size="lg"
                disabled={busy || pin.length < 4}
                onClick={() => submit(pin)}
              >
                {busy ? "Processing…" : "Confirm & pay"}
              </Button>
              <p className="text-center text-[11px] text-ink-400">
                Forgot your PIN?{" "}
                <Link href="/dashboard/settings/txn-pin" className="font-semibold text-brand-700 hover:underline">
                  Reset it in Settings
                </Link>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
