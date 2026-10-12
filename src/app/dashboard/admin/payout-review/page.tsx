"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  id: string;
  userId: string;
  userCode: string | null;
  amount: number;
  totalDebit: number;
  mode: string;
  beneficiaryName: string;
  accountLast4: string | null;
  providerReferenceId: string;
  providerTxnId: string | null;
  failureReason: string | null;
  processedAt: string | null;
  createdAt: string;
};

type ActionKind = "recover" | "poll" | "force_paid" | "force_failed";

function ageLabel(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
}

export default function HeldPayoutsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [exposure, setExposure] = useState(0);
  const [loading, setLoading] = useState(true);

  const [pending, setPending] = useState<{ row: Row; kind: ActionKind } | null>(null);
  const [resolving, setResolving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/payouts/held");
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
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const runResolve = useCallback(
    async (payoutId: string, action: ActionKind, value?: string) => {
      setResolving(true);
      try {
        const body: Record<string, unknown> = { payoutId, action };
        if (action === "poll") body.reference = value;
        else if (action === "force_paid") body.utr = value || undefined;
        else if (action === "force_failed") body.note = value || undefined;

        const res = await fetch("/api/admin/payouts/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof d?.error === "string" ? d.error : "Resolve failed");

        if (d.dualControl) {
          // Maker-checker: a large force action needs a second, different admin.
          toast.info(
            typeof d.message === "string"
              ? d.message
              : "A second, different admin must approve this action."
          );
          await load();
          return false;
        }

        if (!d.changed) {
          toast.info(
            action === "recover" || action === "poll"
              ? `Still held — the rail reports PROCESSING${
                  d.recoveredReference ? ` (ref ${d.recoveredReference})` : " and no reference could be recovered"
                }. It will keep polling.`
              : `No change — status is ${d.status}.`
          );
        } else {
          const label =
            d.status === "SUCCESS"
              ? "settled (hold captured)"
              : d.status === "FAILED"
              ? "failed (hold released to wallet)"
              : d.status === "REVERSED"
              ? "reversed (refunded)"
              : d.status;
          toast.success(`Resolved — ${label}.`);
        }
        await load();
        return d.changed as boolean;
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
      header: "Payout",
      render: (r) => (
        <div>
          <p className="font-mono text-xs font-medium text-ink-900">{r.providerReferenceId}</p>
          <p className="text-xs text-ink-400">
            {r.mode} · {formatIST(r.processedAt ?? r.createdAt)}
          </p>
        </div>
      ),
    },
    {
      key: "beneficiary",
      header: "Beneficiary",
      render: (r) => (
        <div>
          <p className="font-medium text-ink-900">{r.beneficiaryName}</p>
          <p className="text-xs text-ink-400">
            {r.mode === "UPI" ? "VPA" : "A/C"} ••{r.accountLast4 ?? "----"} · {r.userCode ?? r.userId.slice(0, 8)}
          </p>
        </div>
      ),
    },
    {
      key: "amount",
      header: "Held",
      render: (r) => (
        <div>
          <span className="font-semibold text-ink-900">{formatINR(r.totalDebit)}</span>
          <p className="text-xs text-ink-400">payout {formatINR(r.amount)}</p>
        </div>
      ),
    },
    {
      key: "age",
      header: "Age",
      render: (r) => <span className="text-sm text-ink-600">{ageLabel(r.processedAt ?? r.createdAt)}</span>,
    },
    {
      key: "railref",
      header: "Rail ref",
      render: (r) => (
        <div className="max-w-[180px]">
          <p className="truncate font-mono text-xs text-ink-600" title={r.providerTxnId ?? undefined}>
            {r.providerTxnId ?? "— (lost)"}
          </p>
          {r.failureReason && (
            <p className="truncate text-xs text-amber-600" title={r.failureReason}>
              {r.failureReason}
            </p>
          )}
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
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" onClick={() => setPending({ row: r, kind: "recover" })}>
            Auto-resolve
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPending({ row: r, kind: "poll" })}>
            Enter rail ref
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPending({ row: r, kind: "force_paid" })}>
            Mark paid
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPending({ row: r, kind: "force_failed" })}>
            Mark failed
          </Button>
        </div>
      ),
    },
  ];

  const dialog = useMemo(() => {
    if (!pending) return null;
    const { row, kind } = pending;
    const ref = <span className="font-mono text-xs">{row.providerReferenceId}</span>;
    const amt = formatINR(row.totalDebit);
    switch (kind) {
      case "recover":
        return {
          tone: "default" as const,
          title: "Auto-recover & poll the rail?",
          description: (
            <>
              We&apos;ll try to recover the Same Day reference for {ref} by matching {amt} to {row.beneficiaryName}
              &nbsp;(••{row.accountLast4 ?? "----"}) in the rail&apos;s recent transactions, then poll its status.
              No money moves unless the rail reports a terminal state.
            </>
          ),
          confirmLabel: "Recover & poll",
          input: undefined,
        };
      case "poll":
        return {
          tone: "default" as const,
          title: "Enter the Same Day reference_id",
          description: (
            <>
              The transfer response for {ref} was lost. Open it in the Same Day panel, copy its{" "}
              <span className="font-semibold">reference_id</span>, and paste it to poll the authoritative status.
            </>
          ),
          confirmLabel: "Save ref & poll",
          input: { label: "Same Day reference_id", placeholder: "not a PO… id", required: true },
        };
      case "force_paid":
        return {
          tone: "default" as const,
          title: "Confirm the bank DID disburse?",
          description: (
            <>
              Only do this if a bank statement / UTR confirms {amt} reached {row.beneficiaryName}. This captures the
              hold into a real debit for {ref}. Enter the UTR if you have it.
            </>
          ),
          confirmLabel: "Capture — mark paid",
          input: { label: "UTR (optional)", placeholder: "bank UTR", required: false },
        };
      case "force_failed":
        return {
          tone: "danger" as const,
          title: "Confirm the bank did NOT disburse?",
          description: (
            <>
              Only do this if you&apos;ve confirmed {amt} did NOT leave for {row.beneficiaryName}. This RELEASES the
              hold back to the retailer&apos;s spendable balance for {ref}. If the bank actually paid, this is a
              double-spend.
            </>
          ),
          confirmLabel: "Release — mark failed",
          input: { label: "Reason", placeholder: "why it did not disburse", required: true },
        };
    }
  }, [pending]);

  return (
    <div className="space-y-6">
      <Reveal distance={14} duration={0.4}>
        <PageHeader
          title="Held Payouts"
          description={
            total > 0
              ? `${formatNumber(total)} payout(s) held after an indeterminate send · ${formatINR(
                  exposure
                )} exposure. Funds are NOT released — resolve each against the rail.`
              : "No payouts are currently held for review."
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
              These payouts returned an <span className="font-semibold">indeterminate</span> result (lost response /
              5xx / timeout) — the bank may have disbursed, so the hold is retained. The recon sweep tries{" "}
              <span className="font-semibold">reference recovery</span> + poll automatically.{" "}
              <span className="font-semibold">Auto-resolve</span> forces that now; use{" "}
              <span className="font-semibold">Enter rail ref</span> when the reference was lost, and only use{" "}
              <span className="font-semibold">Mark paid / failed</span> after confirming the bank outcome manually.
            </p>
          </div>
          <DataTable columns={columns} data={rows} loading={loading} empty="No payouts are held for review." />
        </Panel>
      </Reveal>

      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        busy={resolving}
        tone={dialog?.tone ?? "default"}
        title={dialog?.title ?? ""}
        description={dialog?.description}
        confirmLabel={dialog?.confirmLabel ?? "Confirm"}
        cancelLabel="Cancel"
        input={dialog?.input}
        onConfirm={async (value) => {
          if (!pending) return;
          const done = await runResolve(pending.row.id, pending.kind, value);
          if (done || pending.kind === "recover" || pending.kind === "poll") setPending(null);
        }}
      />
    </div>
  );
}
