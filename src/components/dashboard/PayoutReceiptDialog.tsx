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

/** Mirrors the JSON returned by GET /api/payout/[id]/receipt. */
type Party = {
  name: string;
  code: string | null;
  shopName: string | null;
  address: string | null;
  phone: string | null;
  gstin: string | null;
};

type PayoutReceiptJson = {
  reference: string;
  status: string;
  statusKind: "success" | "pending" | "failed";
  date: string;
  payer: Party;
  beneficiary: { name: string; accountLast4: string; mode: string; utr: string | null };
  amount: number;
  serviceCharge: number;
  gst: number;
  cgst: number;
  sgst: number;
  gstRate: number;
  totalDebit: number;
};

const badgeVariant: Record<PayoutReceiptJson["statusKind"], "success" | "warning" | "danger"> = {
  success: "success",
  pending: "warning",
  failed: "danger",
};

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });
}

export function PayoutReceiptDialog({
  payoutId,
  open,
  onClose,
}: {
  payoutId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<PayoutReceiptJson | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    if (!open || !payoutId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    fetch(`/api/payout/${encodeURIComponent(payoutId)}/receipt`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to load receipt");
        return res.json();
      })
      .then((json) => {
        if (!cancelled) setData(json.data as PayoutReceiptJson);
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
  }, [open, payoutId]);

  const fetchPdf = useCallback(async (): Promise<Blob> => {
    const res = await fetch(`/api/payout/${encodeURIComponent(payoutId!)}/receipt?format=pdf`);
    if (!res.ok) throw new Error("Could not generate the receipt PDF");
    return res.blob();
  }, [payoutId]);

  const handleDownload = useCallback(async () => {
    if (!payoutId || !data) return;
    setDownloading(true);
    try {
      const blob = await fetchPdf();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `payout-receipt-${data.reference}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }, [payoutId, data, fetchPdf]);

  const handleShare = useCallback(async () => {
    if (!payoutId || !data) return;
    setSharing(true);
    try {
      const title = `${company.brand} payout receipt · ${data.reference}`;
      const summary =
        `${company.brand} payout receipt\n` +
        `Reference: ${data.reference}\n` +
        `Beneficiary: ${data.beneficiary.name} (****${data.beneficiary.accountLast4})\n` +
        `Amount: ${formatINR(data.amount)}\n` +
        (data.beneficiary.utr ? `UTR: ${data.beneficiary.utr}\n` : "") +
        `Total debited: ${formatINR(data.totalDebit)}\n` +
        `Status: ${data.status}\n` +
        `Date: ${fmtDateTime(data.date)}`;

      const nav = typeof navigator !== "undefined" ? (navigator as Navigator) : null;
      if (nav && "canShare" in nav && typeof nav.share === "function") {
        try {
          const blob = await fetchPdf();
          const file = new File([blob], `payout-receipt-${data.reference}.pdf`, { type: "application/pdf" });
          if (nav.canShare({ files: [file] })) {
            await nav.share({ title, text: summary, files: [file] });
            return;
          }
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
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

      await navigator.clipboard.writeText(summary);
      toast.success("Receipt details copied to clipboard");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sharing failed");
    } finally {
      setSharing(false);
    }
  }, [payoutId, data, fetchPdf]);

  const halfRate = data ? data.gstRate / 2 : 0;
  const fmtRate = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Payout receipt"
      title={data ? data.reference : "Receipt"}
      subtitle={data ? `To ${data.beneficiary.name}` : undefined}
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
              <Badge variant={badgeVariant[data.statusKind]}>{data.status}</Badge>
              <p className="mt-2 text-[11px] font-semibold uppercase tracking-widest text-ink-400">
                Payout receipt
              </p>
              <p className="mt-0.5 text-[11px] text-ink-500">{fmtDateTime(data.date)} IST</p>
            </div>
          </div>

          {/* Parties */}
          <div className="grid gap-5 py-4 sm:grid-cols-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-brand-700">From</p>
              <p className="mt-1.5 font-semibold text-ink-900">{data.payer.name}</p>
              {data.payer.shopName && <p className="text-xs text-ink-500">{data.payer.shopName}</p>}
              {data.payer.code && <p className="text-xs text-ink-500">Retailer code: {data.payer.code}</p>}
              {data.payer.address && <p className="mt-1 text-xs leading-relaxed text-ink-500">{data.payer.address}</p>}
              {data.payer.phone && <p className="text-xs text-ink-500">Phone: {data.payer.phone}</p>}
              {data.payer.gstin && <p className="text-xs text-ink-500">GSTIN: {data.payer.gstin}</p>}
            </div>
            <div className="sm:text-right">
              <p className="text-[10px] font-bold uppercase tracking-widest text-brand-700">Beneficiary</p>
              <dl className="mt-1.5 space-y-0.5 text-xs">
                <Meta label="Name" value={data.beneficiary.name} />
                <Meta label="Account" value={`****${data.beneficiary.accountLast4}`} mono />
                <Meta label="Mode" value={data.beneficiary.mode} />
                {data.beneficiary.utr && <Meta label="UTR" value={data.beneficiary.utr} mono />}
                <Meta label="Reference" value={data.reference} mono />
              </dl>
            </div>
          </div>

          {/* Breakdown */}
          <div className="rounded-xl border border-ink-100 bg-ink-50/40 p-4">
            <Line label="Payout amount (beneficiary receives)" value={data.amount} />
            <Line label="Service charge (taxable value)" value={data.serviceCharge} muted />
            {data.gst > 0 && (
              <>
                <Line label={`CGST @ ${fmtRate(halfRate)}%`} value={data.cgst} muted />
                <Line label={`SGST @ ${fmtRate(halfRate)}%`} value={data.sgst} muted />
              </>
            )}
            <div className="my-2 border-t border-dashed border-ink-200" />
            <Line label="Total debited from your wallet" value={data.totalDebit} strong />
          </div>

          {/* GST summary strip */}
          {data.gst > 0 && (
            <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-brand-100 bg-brand-100 sm:grid-cols-4">
              <GstCell label="Taxable value" value={data.serviceCharge} />
              <GstCell label="CGST" value={data.cgst} />
              <GstCell label="SGST" value={data.sgst} />
              <GstCell label="Total GST" value={data.gst} />
            </div>
          )}

          <p className="mt-4 text-[10px] leading-relaxed text-ink-400">
            This is a system-generated receipt and does not require a signature. The beneficiary
            receives the payout amount; the service charge and GST are added on top of your wallet
            debit. For support, contact {company.supportEmail} · {company.phone}.
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
}: {
  label: string;
  value: number;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className={`${muted ? "text-ink-500" : strong ? "font-semibold text-ink-900" : "text-ink-700"} text-sm`}>
        {label}
      </span>
      <span
        className={`text-sm tabular-nums ${
          strong ? "font-bold text-ink-900" : muted ? "text-ink-500" : "font-medium text-ink-800"
        }`}
      >
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
