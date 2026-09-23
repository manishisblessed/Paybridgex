"use client";

import { CheckCircle2, X, Copy, ReceiptText } from "lucide-react";
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { CountUp } from "@/components/motion";
import { useAuth } from "@/lib/useAuth";
import { ReceiptDialog } from "@/components/dashboard/ReceiptDialog";

/** Branding line shown on every payment result. */
function payByLine(userCode?: string | null): string {
  return userCode
    ? `Pay by Paybridgex · RT Code ${userCode}`
    : "Pay by Paybridgex";
}

export type TxnResult = {
  refId: string;
  service: string;
  amount: number;
  customer?: string;
  meta?: Record<string, string | number>;
} | null;

export function TransactionResult({
  result,
  onClose
}: {
  result: TxnResult;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const { session } = useAuth();
  const userCode = session?.userCode;
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!result) {
      setCopied(false);
      setReceiptOpen(false);
    }
  }, [result]);

  if (!result) return null;

  function copy() {
    if (!result) return;
    navigator.clipboard.writeText(result.refId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  /** Fade-and-rise entrance for the detail rows; static when motion is reduced. */
  const rowAnim = (i: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 8 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.3, delay: 0.2 + i * 0.06 },
        };

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 grid place-items-center bg-ink-900/50 px-4 py-8 backdrop-blur"
      role="dialog"
      aria-modal
    >
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 18, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={
          reduce
            ? { duration: 0.15 }
            : { type: "spring", stiffness: 300, damping: 26 }
        }
        className="relative w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-glow"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full bg-ink-100 text-ink-700 hover:bg-ink-200"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="relative overflow-hidden bg-[#0b1030] px-6 py-8 text-center text-white">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-accent-500 via-accent-600 to-accent-700 opacity-90" aria-hidden />
          <div className="pointer-events-none absolute -left-10 -top-10 h-32 w-32 rounded-full bg-white/10 blur-2xl" aria-hidden />
          <div className="pointer-events-none absolute -bottom-12 -right-8 h-28 w-28 rounded-full bg-brand-400/25 blur-2xl" aria-hidden />
          <span className="pointer-events-none absolute left-8 top-7 h-1 w-1 rounded-full bg-white/50" aria-hidden />
          <span className="pointer-events-none absolute right-12 top-11 h-1.5 w-1.5 rounded-full bg-white/40" aria-hidden />
          <span className="pointer-events-none absolute bottom-9 left-14 h-1 w-1 rounded-full bg-white/40" aria-hidden />
          <span className="pointer-events-none absolute bottom-14 right-8 h-1 w-1 rounded-full bg-white/30" aria-hidden />
          <span className="relative mx-auto grid h-16 w-16 place-items-center rounded-full bg-white/20 backdrop-blur">
            {!reduce && (
              <motion.span
                initial={{ scale: 0.7, opacity: 0.8 }}
                animate={{ scale: 1.7, opacity: 0 }}
                transition={{ duration: 1.1, delay: 0.4, ease: "easeOut" }}
                className="absolute inset-0 rounded-full border-2 border-white/50"
                aria-hidden
              />
            )}
            <motion.span
              initial={reduce ? false : { scale: 0 }}
              animate={{ scale: 1 }}
              transition={
                reduce
                  ? { duration: 0 }
                  : { type: "spring", stiffness: 380, damping: 18, delay: 0.15 }
              }
              className="grid place-items-center"
            >
              <CheckCircle2 className="h-9 w-9" />
            </motion.span>
          </span>
          <p className="relative mt-4 font-display text-lg font-semibold">
            Transaction successful
          </p>
          <p className="relative mt-1 font-display text-3xl font-bold tracking-tight">
            <CountUp value={result.amount} prefix="₹" duration={0.9} />
          </p>
          <p className="relative text-xs text-white/80">{result.service}</p>
        </div>

        <div className="space-y-3 p-6">
          <motion.div
            {...rowAnim(0)}
            className="flex items-center justify-between rounded-xl bg-ink-50 px-4 py-3"
          >
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-500">
                Reference ID
              </p>
              <p className="font-mono text-sm font-semibold text-ink-900">
                {result.refId}
              </p>
            </div>
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center gap-1 rounded-full border border-ink-200 px-3 py-1 text-xs font-semibold text-ink-700 hover:bg-white"
            >
              <Copy className="h-3 w-3" />
              {copied ? "Copied" : "Copy"}
            </button>
          </motion.div>

          {result.customer && (
            <motion.div {...rowAnim(1)} className="rounded-xl bg-ink-50 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-500">
                Customer
              </p>
              <p className="text-sm font-medium text-ink-900">
                {result.customer}
              </p>
            </motion.div>
          )}

          {result.meta &&
            Object.entries(result.meta).map(([k, v], i) => (
              <motion.div
                key={k}
                {...rowAnim(2 + i)}
                className="flex items-center justify-between rounded-xl bg-ink-50 px-4 py-3"
              >
                <span className="text-xs font-semibold uppercase tracking-widest text-ink-500">
                  {k}
                </span>
                <span className="text-sm font-medium text-ink-900">{v}</span>
              </motion.div>
            ))}

          <p className="pt-1 text-center text-xs font-semibold text-accent-600">
            {payByLine(userCode)}
          </p>

          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setReceiptOpen(true)}>
              <ReceiptText className="h-4 w-4" />
              View receipt
            </Button>
            <Button onClick={onClose} className="flex-1">
              Done
            </Button>
          </div>
        </div>
      </motion.div>

      {/* Full detailed receipt (company logo/info, bill & charge breakdown, GST,
          PDF download and share) — fetched live from the transaction ledger. */}
      <ReceiptDialog
        refId={result.refId}
        open={receiptOpen}
        onClose={() => setReceiptOpen(false)}
      />
    </motion.div>
  );
}
