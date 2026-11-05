"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import { Panel, StatusPill } from "@/components/dashboard/ui";
import { Reveal } from "@/components/motion";
import { formatINR, formatNumber, formatIST } from "@/lib/utils";
import { RefreshCw, ShieldQuestion, Copy, Check, FileSearch } from "lucide-react";

type Row = {
  refId: string;
  service: string;
  partner: string | null;
  amount: number;
  fee: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  partnerTxnId: string | null;
  refundEligibleAt: string | null;
  requestId: string | null;
  billFetchRef: string | null;
  orderId: string | null;
  operator: string | null;
  billerName: string | null;
  customer: string | null;
  customerMobile: string | null;
  cardholderName: string | null;
  user: { name: string; email: string; userCode: string | null; phone?: string | null } | null;
};

/** Read-only live provider probe result (from /api/admin/transactions/status-check). */
type LiveStatus = {
  providerStatus: "SUCCESS" | "FAILED" | "REFUNDED" | "PENDING" | "UNRESOLVED" | "NOT_POLLED";
  requestId: string | null;
  matchedRef: string | null;
  amount: number | null;
  pollable: boolean;
  rail: string;
};

/** Exact IST date + time (with seconds) — the authoritative attempt timestamp. */
function istFull(iso: string): string {
  return formatIST(iso, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** One-tap copy chip for a provider reference (request_id / bill_fetch_ref). */
function CopyChip({ value, mono = true }: { value: string; mono?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title="Copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          toast.success("Copied");
          setTimeout(() => setDone(false), 1200);
        } catch {
          toast.error("Copy failed");
        }
      }}
      className="group inline-flex max-w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-ink-100"
    >
      <span className={`truncate ${mono ? "font-mono text-[11px]" : "text-xs"} text-ink-700`}>{value}</span>
      {done ? (
        <Check className="h-3 w-3 shrink-0 text-emerald-600" />
      ) : (
        <Copy className="h-3 w-3 shrink-0 text-ink-400 group-hover:text-ink-600" />
      )}
    </button>
  );
}

/** A label + copyable reference (or an em-dash when absent). */
function RefLine({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-ink-400">{label}</span>
      {value ? <CopyChip value={value} /> : <span className="text-xs text-ink-300">—</span>}
    </div>
  );
}

/** Short "in 24m" / "due now" label for a scheduled-refund timestamp. */
function etaLabel(iso: string): string {
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  if (mins <= 0) return "due now";
  if (mins < 60) return `in ${mins}m`;
  return `in ${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function ageLabel(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
}

export default function NeedsReviewPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [exposure, setExposure] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const pageSize = 25;

  // Resolve flow: step 1 = confirm, step 2 = (only if provider couldn't resolve)
  // collect the pay-step reference read from the provider panel.
  const [confirmRef, setConfirmRef] = useState<string | null>(null);
  const [needProviderRef, setNeedProviderRef] = useState<string | null>(null);
  const [confirmNotFound, setConfirmNotFound] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  // Read-only verification sheet for a single held row.
  const [detailsRow, setDetailsRow] = useState<Row | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveStatus, setLiveStatus] = useState<LiveStatus | null>(null);

  /** Open the details sheet for a row with a clean live-status slate. */
  const openDetails = useCallback((r: Row) => {
    setLiveStatus(null);
    setDetailsRow(r);
  }, []);

  /** Read-only: poll the provider live and show the authoritative status + recovered request_id. */
  const fetchLiveStatus = useCallback(async (refId: string) => {
    setLiveLoading(true);
    try {
      const res = await fetch("/api/admin/transactions/status-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof d?.error === "string" ? d.error : "Status check failed");
      setLiveStatus({
        providerStatus: d.providerStatus,
        requestId: d.requestId ?? null,
        matchedRef: d.matchedRef ?? null,
        amount: typeof d.amount === "number" ? d.amount : null,
        pollable: !!d.pollable,
        rail: d.rail,
      });
      toast.success(`Provider status: ${d.providerStatus}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Status check failed");
    } finally {
      setLiveLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/transactions/needs-review?page=${page}`);
      const d = await res.json();
      if (!res.ok) throw new Error(typeof d?.error === "string" ? d.error : "Failed to load");
      setRows(d.items);
      setTotal(d.total);
      setExposure(d.exposure ?? 0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  // Force-refund a txn whose provider has no record (ORDER_NOT_FOUND).
  const runForceRefundNotFound = useCallback(
    async (refId: string): Promise<boolean> => {
      setResolving(true);
      try {
        const res = await fetch("/api/admin/transactions/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refId, forceRefundNotFound: true }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof d?.error === "string" ? d.error : "Refund failed");
        if (d.outcome === "refunded") {
          toast.success(`${refId}: provider confirmed no record — held reserve refunded to wallet.`);
        } else {
          toast.info(`${refId}: ${d.outcome ?? "no change"}.`);
        }
        await load();
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Force refund failed");
        return false;
      } finally {
        setResolving(false);
      }
    },
    [load]
  );

  // Calls the API-verified resolver. Returns true when the row left the queue so
  // the dialogs can close; false when the provider needs a manual pay-step ref.
  const runResolve = useCallback(
    async (refId: string, providerRef?: string): Promise<boolean> => {
      setResolving(true);
      try {
        const res = await fetch("/api/admin/transactions/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refId, ...(providerRef ? { providerRef } : {}) }),
        });
        const d = await res.json().catch(() => ({}));

        // 422 → provider couldn't confirm from any stored ref; ask for the
        // pay-step reference from the provider panel.
        if (res.status === 422 || d?.outcome === "unresolved") {
          toast.info(`${refId}: provider couldn't confirm. Enter the pay-step reference from the panel.`);
          setConfirmRef(null);
          setNeedProviderRef(refId);
          return false;
        }
        if (!res.ok) throw new Error(typeof d?.error === "string" ? d.error : "Resolve failed");

        switch (d.outcome) {
          case "corrected":
            toast.success(
              d.clawback?.placed
                ? `${refId}: confirmed SUCCESS — ${formatINR(d.clawback.refunded)} clawed back via lien.`
                : `${refId}: confirmed SUCCESS and settled.`
            );
            break;
          case "settled":
            toast.success(`${refId}: provider confirmed SUCCESS — settled.`);
            break;
          case "refunded":
            toast.success(`${refId}: provider reported failure — reserve refunded to the wallet.`);
            break;
          case "noop":
            toast.info(`${refId}: already consistent with the provider (${d.providerStatus ?? "—"}).`);
            break;
          default:
            toast.info(`${refId}: ${d.outcome ?? "no change"}.`);
        }
        await load();
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Resolve failed");
        return false;
      } finally {
        setResolving(false);
      }
    },
    [load]
  );

  const columns: Column<Row>[] = [
    {
      key: "ref",
      header: "Reference",
      render: (r) => (
        <div>
          <p className="font-mono text-xs font-medium text-ink-900">{r.refId}</p>
          <p className="text-xs text-ink-400">
            {r.service.replace(/_/g, " ").toLowerCase()} · {r.partner ?? "—"}
          </p>
          <p className="text-[11px] text-ink-400">{istFull(r.createdAt)} IST</p>
        </div>
      ),
    },
    {
      key: "user",
      header: "Retailer",
      render: (r) => (
        <div>
          <p className="font-medium text-ink-900">{r.user?.name ?? "—"}</p>
          <p className="text-xs text-ink-400">{r.user?.userCode ?? r.user?.email ?? "—"}</p>
          {r.user?.phone && <p className="text-xs text-ink-400">{r.user.phone}</p>}
        </div>
      ),
    },
    {
      key: "biller",
      header: "Biller / Card",
      render: (r) => (
        <div>
          <p className="font-medium text-ink-900">{r.billerName ?? r.operator ?? "—"}</p>
          <p className="text-xs text-ink-400">
            {r.operator ? `code ${r.operator}` : "—"} · card ••{r.customer ?? "—"}
          </p>
          {r.customerMobile && <p className="text-xs text-ink-400">mob {r.customerMobile}</p>}
        </div>
      ),
    },
    {
      key: "amount",
      header: "Held",
      render: (r) => (
        <div>
          <span className="font-semibold text-ink-900">{formatINR(r.amount + r.fee)}</span>
          <p className="text-xs text-ink-400">amt {formatINR(r.amount)} + fee {formatINR(r.fee)}</p>
        </div>
      ),
    },
    {
      key: "age",
      header: "Age",
      render: (r) => <span className="text-sm text-ink-600">{ageLabel(r.createdAt)}</span>,
    },
    {
      key: "provref",
      header: "Verify refs",
      render: (r) => (
        <div className="max-w-[260px] space-y-0.5">
          <RefLine label="Req ID" value={r.requestId} />
          <RefLine label="Bill ref" value={r.billFetchRef} />
          {r.partnerTxnId && <RefLine label="Order" value={r.partnerTxnId} />}
          {r.errorCode && (
            <p className="truncate text-xs text-amber-600" title={r.errorMessage ?? undefined}>
              {r.errorCode}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) =>
        r.refundEligibleAt ? (
          <div>
            <StatusPill status="REFUND_SCHEDULED" tone="warning">
              Refund scheduled
            </StatusPill>
            <p className="mt-0.5 text-[11px] text-ink-400">
              provider-confirmed failure · {etaLabel(r.refundEligibleAt)}
            </p>
          </div>
        ) : (
          <StatusPill status="NEEDS_REVIEW" tone="warning">
            Under review
          </StatusPill>
        ),
    },
    {
      key: "actions",
      header: "",
      render: (r) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => openDetails(r)}>
            <FileSearch className="mr-1 h-4 w-4" /> Details
          </Button>
          <Button size="sm" onClick={() => setConfirmRef(r.refId)}>
            Resolve / verify
          </Button>
        </div>
      ),
    },
  ];

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <Reveal distance={14} duration={0.4}>
        <PageHeader
          title="Needs Review"
          description={
            total > 0
              ? `${formatNumber(total)} payment(s) held pending verification · ${formatINR(exposure)} exposure. Funds are NOT refunded — resolve each against the provider.`
              : "No payments are currently held for review."
          }
          actions={
            <Button variant="outline" onClick={load}>
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh
            </Button>
          }
        />
      </Reveal>

      <Reveal distance={16} duration={0.45}>
        <Panel>
          <div className="mb-3 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-700 ring-1 ring-amber-200/70">
            <ShieldQuestion className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              These payments returned an <span className="font-semibold">indeterminate</span> result — the provider may
              have charged the customer. The recon sweep and webhook resolve most automatically within minutes.{" "}
              <span className="font-semibold">Resolve / verify</span> re-checks the provider&apos;s status API and then
              settles (clawing back any refund via a lien — never a negative wallet) or refunds, based on the
              authoritative outcome.
            </p>
          </div>
          <DataTable columns={columns} data={rows} loading={loading} />
        </Panel>
      </Reveal>

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-ink-500">
          <span>
            Page {page} of {pages} · {formatNumber(total)} held
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Step 1 — confirm the API-verified resolution. */}
      <ConfirmDialog
        open={confirmRef !== null}
        onClose={() => setConfirmRef(null)}
        busy={resolving}
        tone="default"
        title="Verify with provider and finalize?"
        description={
          <>
            We&apos;ll re-check <span className="font-mono text-xs">{confirmRef}</span> against the provider&apos;s status
            API. If SUCCESS, it&apos;s settled and any earlier refund is clawed back via a lien (never a negative
            wallet). If FAILED, the held reserve is refunded. No money moves unless the provider confirms.
          </>
        }
        confirmLabel="Verify & resolve"
        cancelLabel="Cancel"
        onConfirm={async () => {
          if (confirmRef) await runResolve(confirmRef);
          setConfirmRef(null);
        }}
      />

      {/* Step 2 — only when the provider couldn't resolve from stored refs. */}
      <ConfirmDialog
        open={needProviderRef !== null}
        onClose={() => setNeedProviderRef(null)}
        busy={resolving}
        tone="default"
        title="Enter the pay-step reference"
        description={
          <>
            The provider couldn&apos;t confirm <span className="font-mono text-xs">{needProviderRef}</span> from any
            stored reference. Open it in the provider panel, copy its pay-step order_id / request_id, and paste it
            below to verify and resolve.
            <br />
            <br />
            <span className="text-amber-600">
              If the transaction does <strong>not exist</strong> in the provider panel at all, use
              &quot;Not found — refund&quot; to release the held funds.
            </span>
          </>
        }
        confirmLabel="Verify with this ref"
        cancelLabel="Cancel"
        input={{ label: "Pay-step order_id / request_id", placeholder: "P2N_PAY_… or SDS…", required: true }}
        onConfirm={async (providerRef) => {
          if (needProviderRef && providerRef) {
            const done = await runResolve(needProviderRef, providerRef);
            if (done) setNeedProviderRef(null);
          }
        }}
        extraActions={
          <Button
            variant="outline"
            size="sm"
            disabled={resolving}
            className="text-red-600 border-red-200 hover:bg-red-50"
            onClick={() => {
              const ref = needProviderRef;
              setNeedProviderRef(null);
              setConfirmNotFound(ref);
            }}
          >
            Not found — refund
          </Button>
        }
      />

      {/* Step 3 — final confirmation for force-refund when provider has no record. */}
      <ConfirmDialog
        open={confirmNotFound !== null}
        onClose={() => setConfirmNotFound(null)}
        busy={resolving}
        tone="danger"
        title="Confirm: provider has no record"
        description={
          <>
            You are confirming that <span className="font-mono text-xs">{confirmNotFound}</span> does{" "}
            <strong>not exist</strong> in the provider panel. The system will re-verify that the provider returns
            &quot;not found&quot; for all known references, then refund the held reserve to the retailer&apos;s wallet.
          </>
        }
        confirmLabel="Confirm refund"
        cancelLabel="Go back"
        onConfirm={async () => {
          if (confirmNotFound) {
            await runForceRefundNotFound(confirmNotFound);
            setConfirmNotFound(null);
          }
        }}
      />

      {/* Read-only verification sheet — full biller details, timing & provider refs. */}
      <Modal
        open={detailsRow !== null}
        onClose={() => setDetailsRow(null)}
        eyebrow="Verify with provider"
        title={detailsRow?.refId ?? "Transaction"}
        subtitle={
          detailsRow
            ? `${detailsRow.service.replace(/_/g, " ").toLowerCase()} · ${detailsRow.partner ?? "—"}`
            : undefined
        }
        size="lg"
        footer={
          detailsRow && (
            <>
              <Button variant="outline" size="sm" onClick={() => setDetailsRow(null)}>
                Close
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  const ref = detailsRow.refId;
                  setDetailsRow(null);
                  setConfirmRef(ref);
                }}
              >
                Resolve / verify
              </Button>
            </>
          )
        }
      >
        {detailsRow && (
          <div className="space-y-5 text-sm text-ink-800">
            {/* Biller + customer */}
            <section>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-brand-700">Biller &amp; customer</p>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
                <DetailRow label="Biller" value={detailsRow.billerName ?? "—"} />
                <DetailRow label="Biller code" value={detailsRow.operator ?? "—"} />
                <DetailRow label="Card (last 4)" value={detailsRow.customer ? `•• ${detailsRow.customer}` : "—"} />
                <DetailRow label="Cardholder" value={detailsRow.cardholderName ?? "—"} />
                <DetailRow label="Customer mobile" value={detailsRow.customerMobile ?? "—"} />
              </dl>
            </section>

            {/* Retailer */}
            <section>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-brand-700">Retailer</p>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
                <DetailRow label="Name" value={detailsRow.user?.name ?? "—"} />
                <DetailRow label="Code" value={detailsRow.user?.userCode ?? "—"} />
                <DetailRow label="Mobile" value={detailsRow.user?.phone ?? "—"} />
                <DetailRow label="Email" value={detailsRow.user?.email ?? "—"} />
              </dl>
            </section>

            {/* Amount + timing */}
            <section>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-brand-700">Amount &amp; timing</p>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
                <DetailRow label="Amount" value={formatINR(detailsRow.amount)} />
                <DetailRow label="Fee" value={formatINR(detailsRow.fee)} />
                <DetailRow label="Reserve held" value={formatINR(detailsRow.amount + detailsRow.fee)} />
                <DetailRow label="Attempt time" value={`${istFull(detailsRow.createdAt)} IST`} />
                {detailsRow.errorCode && <DetailRow label="Error code" value={detailsRow.errorCode} />}
              </dl>
            </section>

            {/* Provider references — the handles to verify with SameDay */}
            <section>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-brand-700">
                Provider references (tap to copy)
              </p>
              <div className="space-y-2 rounded-xl border border-ink-100 bg-ink-50/50 p-3">
                <RefLine label="Request ID" value={detailsRow.requestId} />
                <RefLine label="Bill fetch ref" value={detailsRow.billFetchRef} />
                <RefLine label="Order / partner txn" value={detailsRow.partnerTxnId ?? detailsRow.orderId} />
              </div>
              {!detailsRow.requestId && !detailsRow.billFetchRef && (
                <p className="mt-2 text-xs text-amber-600">
                  No provider reference was captured (the pay response was lost). Verify at the provider using the
                  card ••{detailsRow.customer ?? "?"}, amount {formatINR(detailsRow.amount)}, and attempt time above.
                </p>
              )}
            </section>

            {/* Live provider status — read-only probe + recovered request_id */}
            <section>
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-brand-700">Live provider status</p>
                <Button
                  size="sm"
                  variant="outline"
                  isLoading={liveLoading}
                  onClick={() => fetchLiveStatus(detailsRow.refId)}
                >
                  {!liveLoading && <RefreshCw className="mr-1 h-4 w-4" />} Fetch live status
                </Button>
              </div>

              {liveStatus ? (
                <div className="mt-2 space-y-2 rounded-xl border border-ink-100 bg-ink-50/50 p-3">
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
                    <DetailRow label="Provider status" value={liveStatus.providerStatus} />
                    {liveStatus.amount != null && (
                      <DetailRow label="Provider amount" value={formatINR(liveStatus.amount)} />
                    )}
                  </dl>
                  <RefLine label="Recovered Request ID" value={liveStatus.requestId} />
                  <RefLine label="Matched on" value={liveStatus.matchedRef} />

                  {liveStatus.providerStatus === "PENDING" && (
                    <p className="text-xs text-ink-500">
                      Still PENDING at the provider — keep holding. It clears automatically once the provider returns a
                      terminal outcome.
                    </p>
                  )}
                  {["SUCCESS", "FAILED", "REFUNDED"].includes(liveStatus.providerStatus) && (
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-emerald-600">
                        Provider is terminal ({liveStatus.providerStatus}) — Resolve / verify will finalize it.
                      </p>
                      <Button
                        size="sm"
                        onClick={() => {
                          const ref = detailsRow.refId;
                          setDetailsRow(null);
                          setConfirmRef(ref);
                        }}
                      >
                        Resolve / verify
                      </Button>
                    </div>
                  )}
                  {liveStatus.providerStatus === "UNRESOLVED" && (
                    <div className="space-y-2">
                      <p className="text-xs text-amber-600">
                        The provider returned no record for any reference we hold (ORDER_NOT_FOUND). If this payment is
                        also absent from the provider panel, the held reserve can be safely released.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-red-200 text-red-600 hover:bg-red-50"
                        onClick={() => {
                          const ref = detailsRow.refId;
                          setDetailsRow(null);
                          setConfirmNotFound(ref);
                        }}
                      >
                        Not found — refund
                      </Button>
                    </div>
                  )}
                  {liveStatus.providerStatus === "NOT_POLLED" && (
                    <p className="text-xs text-ink-500">This rail is finalized by its own pipeline; no status poll applies.</p>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-xs text-ink-400">
                  Polls Sameday&apos;s <span className="font-mono">bill/status</span> live (read-only) and recovers the
                  pay-step Request ID. Runs from the whitelisted server.
                </p>
              )}
            </section>
          </div>
        )}
      </Modal>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-ink-50 py-0.5">
      <dt className="shrink-0 text-xs text-ink-500">{label}</dt>
      <dd className="truncate text-right font-medium text-ink-900">{value}</dd>
    </div>
  );
}
