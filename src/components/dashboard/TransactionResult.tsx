"use client";

import { CheckCircle2, X, Copy, Download } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { CountUp } from "@/components/motion";
import { useAuth } from "@/lib/useAuth";

/** Branding line shown on every payment result/receipt. */
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

function buildReceiptHtml(r: NonNullable<TxnResult>, userCode?: string | null): string {
  const date = new Date().toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const metaRows = r.meta
    ? Object.entries(r.meta)
        .map(
          ([k, v]) =>
            `<tr><td style="padding:6px 0;color:#666;font-size:13px">${k}</td><td style="padding:6px 0;text-align:right;font-weight:600;font-size:13px">${v}</td></tr>`
        )
        .join("")
    : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt — ${r.refId}</title>
<style>@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}.r{max-width:400px;margin:24px auto;font-family:system-ui,sans-serif;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden}.hdr{background:linear-gradient(135deg,#059669,#047857);color:#fff;padding:32px 24px;text-align:center}.hdr h2{margin:0 0 4px;font-size:18px;font-weight:600}.hdr .amt{font-size:28px;font-weight:700;margin:8px 0 2px}.hdr .svc{font-size:12px;opacity:.8}.body{padding:20px 24px}table{width:100%;border-collapse:collapse}tr+tr{border-top:1px solid #f3f4f6}.foot{text-align:center;padding:16px 24px;font-size:11px;color:#999;border-top:1px dashed #e5e7eb}</style></head>
<body><div class="r"><div class="hdr"><h2>Transaction Successful</h2><div class="amt">₹${r.amount.toLocaleString("en-IN")}</div><div class="svc">${r.service}</div></div>
<div class="body"><table><tr><td style="padding:6px 0;color:#666;font-size:13px">Reference ID</td><td style="padding:6px 0;text-align:right;font-weight:600;font-size:13px;font-family:monospace">${r.refId}</td></tr>
${r.customer ? `<tr><td style="padding:6px 0;color:#666;font-size:13px">Customer</td><td style="padding:6px 0;text-align:right;font-weight:600;font-size:13px">${r.customer}</td></tr>` : ""}
${metaRows}
<tr><td style="padding:6px 0;color:#666;font-size:13px">Date</td><td style="padding:6px 0;text-align:right;font-weight:600;font-size:13px">${date}</td></tr></table></div>
<div class="foot"><div style="font-weight:600;color:#059669;margin-bottom:4px">${payByLine(userCode)}</div>Paybridgex — Smart Payments. Trusted Solutions.</div></div></body></html>`;
}

export function TransactionResult({
  result,
  onClose
}: {
  result: TxnResult;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const { session } = useAuth();
  const userCode = session?.userCode;
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!result) setCopied(false);
  }, [result]);

  const downloadReceipt = useCallback(() => {
    if (!result) return;
    const w = window.open("", "_blank", "width=460,height=650");
    if (!w) return;
    w.document.write(buildReceiptHtml(result, userCode));
    w.document.close();
    w.addEventListener("afterprint", () => w.close());
    setTimeout(() => w.print(), 300);
  }, [result, userCode]);

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
            <Button type="button" variant="outline" className="flex-1" onClick={downloadReceipt}>
              <Download className="h-4 w-4" />
              Receipt
            </Button>
            <Button onClick={onClose} className="flex-1">
              Done
            </Button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
