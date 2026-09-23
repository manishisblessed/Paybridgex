"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { Download, Share2, Loader2, ReceiptText } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { company } from "@/lib/data";
import { formatINR } from "@/lib/utils";

/** Mirrors the JSON returned by GET /api/transactions/[refId]/receipt. */
type ReceiptParty = {
  name: string;
  code: string | null;
  shopName: string | null;
  address: string | null;
  phone: string | null;
  gstin: string | null;
};

export type ReceiptDto = {
  refId: string;
  service: string;
  status: "Success" | "Pending" | "Failed";
  date: Date;
  customer: string | null;
  operator: string | null;
  partnerTxnId: string | null;
  amount: number;
  fee: number;
  gst: number;
  cgst: number;
  sgst: number;
  gstRate: number;
  total: number;
  commission: number | null;
  retailer: ReceiptParty;
};

// Note: the API returns `date` as an ISO string, but we only display it.
type ReceiptJson = Omit<ReceiptDto, "date"> & { date: string };

const statusVariant: Record<ReceiptDto["status"], "success" | "warning" | "danger"> = {
  Success: "success",
  Pending: "warning",
  Failed: "danger",
};

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });
}

export function ReceiptDialog({
  refId,
  open,
  onClose,
}: {
  refId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<ReceiptJson | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    if (!open || !refId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    fetch(`/api/transactions/${encodeURIComponent(refId)}/receipt`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to load receipt");
        return res.json();
      })
      .then((json) => {
        if (!cancelled) setData(json.data as ReceiptJson);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load receipt");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, refId]);

  const fetchPdf = useCallback(async (): Promise<Blob> => {
    const res = await fetch(`/api/transactions/${encodeURIComponent(refId!)}/receipt?format=pdf`);
    if (!res.ok) throw new Error("Could not generate the receipt PDF");
    return res.blob();
  }, [refId]);

  const handleDownload = useCallback(async () => {
    if (!refId) return;
    setDownloading(true);
    try {
      const blob = await fetchPdf();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `receipt-${refId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }, [refId, fetchPdf]);

  const handleShare = useCallback(async () => {
    if (!refId || !data) return;
    setSharing(true);
    try {
      const title = `${company.brand} receipt · ${data.refId}`;
      const summary =
        `${company.brand} payment receipt\n` +
        `Ref: ${data.refId}\n` +
        `Service: ${data.service}\n` +
        `Amount: ${formatINR(data.total)}\n` +
        `Status: ${data.status}\n` +
        `Date: ${fmtDateTime(data.date)}`;

      // Preferred path: share the actual PDF file (mobile / supported browsers).
      const nav = typeof navigator !== "undefined" ? (navigator as Navigator) : null;
      if (nav && "canShare" in nav && typeof nav.share === "function") {
        try {
          const blob = await fetchPdf();
          const file = new File([blob], `receipt-${data.refId}.pdf`, { type: "application/pdf" });
          if (nav.canShare({ files: [file] })) {
            await nav.share({ title, text: summary, files: [file] });
            return;
          }
        } catch (err) {
          // AbortError = user dismissed the share sheet; treat as a no-op.
          if (err instanceof DOMException && err.name === "AbortError") return;
          // Otherwise fall through to the text/clipboard path below.
        }
      }

      if (nav && typeof nav.share === "function") {
        try {
          await nav.share({ title, text: summary });
          return;
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
        }
      }

      // Final fallback: copy the summary to the clipboard.
      await navigator.clipboard.writeText(summary);
      toast.success("Receipt details copied to clipboard");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sharing failed");
    } finally {
      setSharing(false);
    }
  }, [refId, data, fetchPdf]);

  const showCharges = !!data && (data.fee > 0 || data.gst > 0);
  const halfRate = data ? data.gstRate / 2 : 0;
  const fmtRate = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Transaction receipt"
      title={refId ?? "Receipt"}
      subtitle={data ? data.service : undefined}
      size="lg"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={handleShare} isLoading={sharing} disabled={!data || loading}>
            {!sharing && <Share2 className="h-4 w-4" />}
            Share
          </Button>
          <Button size="sm" onClick={handleDownload} isLoading={downloading} disabled={!data || loading}>
            {!downloading && <Download className="h-4 w-4" />}
            Download PDF
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading receipt…
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl border border-dashed border-ink-200 bg-ink-50/60 text-ink-300">
            <ReceiptText className="h-5 w-5" />
          </span>
          <p className="max-w-xs text-sm text-ink-500">{error}</p>
        </div>
      ) : data ? (
        <div className="text-sm text-ink-800">
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 pb-4">
            <div className="flex min-w-0 gap-3">
              <Image
                src="/brand-mark.png"
                alt="Paybridgex logo"
                width={44}
                height={44}
                className="h-11 w-11 shrink-0 object-contain"
              />
              <div className="min-w-0">
                <p className="font-display text-lg font-bold text-brand-700">{company.brand}</p>
                <p className="mt-0.5 text-[11px] leading-tight text-ink-500">{company.legalName}</p>
                <p className="mt-0.5 text-[11px] leading-tight text-ink-400">{company.address}</p>
                <p className="mt-0.5 text-[11px] leading-tight text-ink-400">
                  {company.gstin ? `GSTIN: ${company.gstin} · ` : ""}CIN: {company.cin}
                </p>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <Badge variant={statusVariant[data.status]}>{data.status}</Badge>
              <p className="mt-2 text-[11px] font-semibold uppercase tracking-widest text-ink-400">
                Payment receipt
              </p>
              <p className="mt-0.5 text-[11px] text-ink-500">{fmtDateTime(data.date)} IST</p>
            </div>
          </div>

          {/* Parties */}
          <div className="grid gap-5 py-4 sm:grid-cols-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-brand-700">Billed to</p>
              <p className="mt-1.5 font-semibold text-ink-900">{data.retailer.name}</p>
              {data.retailer.shopName && <p className="text-xs text-ink-500">{data.retailer.shopName}</p>}
              {data.retailer.code && <p className="text-xs text-ink-500">Retailer code: {data.retailer.code}</p>}
              {data.retailer.address && <p className="mt-1 text-xs leading-relaxed text-ink-500">{data.retailer.address}</p>}
              {data.retailer.phone && <p className="text-xs text-ink-500">Phone: {data.retailer.phone}</p>}
              {data.retailer.gstin && <p className="text-xs text-ink-500">GSTIN: {data.retailer.gstin}</p>}
            </div>
            <div className="sm:text-right">
              <p className="text-[10px] font-bold uppercase tracking-widest text-brand-700">Transaction</p>
              <dl className="mt-1.5 space-y-0.5 text-xs">
                <Meta label="Service" value={data.service} />
                {data.operator && <Meta label="Operator" value={data.operator} />}
                {data.customer && <Meta label="Customer" value={data.customer} />}
                <Meta label="Reference ID" value={data.refId} mono />
                {data.partnerTxnId && <Meta label="Partner txn" value={data.partnerTxnId} mono />}
              </dl>
            </div>
          </div>

          {/* Breakdown */}
          <div className="rounded-xl border border-ink-100 bg-ink-50/40 p-4">
            <Line label="Transaction amount" value={data.amount} />
            {showCharges && (
              <>
                <Line label="Service charge (taxable value)" value={data.fee} muted />
                {data.gst > 0 && (
                  <>
                    <Line label={`CGST @ ${fmtRate(halfRate)}%`} value={data.cgst} muted />
                    <Line label={`SGST @ ${fmtRate(halfRate)}%`} value={data.sgst} muted />
                  </>
                )}
              </>
            )}
            <div className="my-2 border-t border-dashed border-ink-200" />
            <Line label="Total charged" value={data.total} strong />
            {data.commission !== null && data.commission > 0 && (
              <div className="mt-2 border-t border-ink-100 pt-2">
                <Line label="Commission (your earning)" value={data.commission} accent />
              </div>
            )}
          </div>

          {/* GST summary strip */}
          {data.gst > 0 && (
            <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-brand-100 bg-brand-100 sm:grid-cols-4">
              <GstCell label="Taxable value" value={data.fee} />
              <GstCell label="CGST" value={data.cgst} />
              <GstCell label="SGST" value={data.sgst} />
              <GstCell label="Total GST" value={data.gst} />
            </div>
          )}

          <p className="mt-4 text-[10px] leading-relaxed text-ink-400">
            This is a system-generated receipt and does not require a signature. All amounts are in INR.
            For support, contact {company.supportEmail} · {company.phone}.
          </p>
        </div>
      ) : null}
    </Modal>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 sm:justify-end">
      <dt className="text-ink-500">{label}</dt>
      <dd className={`font-medium text-ink-900 ${mono ? "font-mono text-[11px]" : ""}`}>{value}</dd>
    </div>
  );
}

function Line({
  label,
  value,
  muted,
  strong,
  accent,
}: {
  label: string;
  value: number;
  muted?: boolean;
  strong?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className={`${muted ? "text-ink-500" : strong ? "font-semibold text-ink-900" : "text-ink-700"} text-sm`}>
        {label}
      </span>
      <span
        className={`text-sm tabular-nums ${
          accent ? "font-semibold text-accent-700" : strong ? "font-bold text-ink-900" : muted ? "text-ink-500" : "font-medium text-ink-800"
        }`}
      >
        {accent ? "+" : ""}
        {formatINR(value)}
      </span>
    </div>
  );
}

function GstCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wide text-ink-500">{label}</p>
      <p className="mt-0.5 text-sm font-bold text-ink-900 tabular-nums">{formatINR(value)}</p>
    </div>
  );
}
