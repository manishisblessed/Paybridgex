"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Panel, StatusPill } from "@/components/dashboard/ui";
import { Reveal } from "@/components/motion";
import { formatINR, formatNumber, formatIST } from "@/lib/utils";
import { RefreshCw, ShieldQuestion } from "lucide-react";

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
  billFetchRef: string | null;
  operator: string | null;
  customer: string | null;
  user: { name: string; email: string; userCode: string | null } | null;
};

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
  const [resolving, setResolving] = useState(false);

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
            {r.service.replace(/_/g, " ").toLowerCase()} · {r.partner ?? "—"} · {formatIST(r.createdAt)}
          </p>
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
      header: "Provider ref",
      render: (r) => (
        <div className="max-w-[200px]">
          <p className="truncate font-mono text-xs text-ink-600" title={r.billFetchRef ?? undefined}>
            {r.billFetchRef ?? "—"}
          </p>
          {r.errorCode && <p className="truncate text-xs text-amber-600" title={r.errorMessage ?? undefined}>{r.errorCode}</p>}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: () => (
        <StatusPill status="NEEDS_REVIEW" tone="warning">
          Under review
        </StatusPill>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (r) => (
        <div className="flex justify-end">
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
      />
    </div>
  );
}
