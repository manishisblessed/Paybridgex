"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { formatINR } from "@/lib/utils";
import { useAuth } from "@/lib/useAuth";
import {
  ListChecks,
  RefreshCw,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Loader2,
  FileText,
  Clock,
  Zap,
  CalendarClock,
  Undo2,
} from "lucide-react";

type Slip = {
  id: string;
  uploader: { id: string; name: string; userCode: string | null; role: string };
  tid: string;
  machine: { model: string | null; location: string | null; city: string | null; provider: string; branded: boolean } | null;
  grossAmount: number;
  paymentMode: string;
  settlementPref: "INSTANT" | "T1";
  rrn: string | null;
  authCode: string | null;
  cardType: string | null;
  brandType: string | null;
  txnTime: string | null;
  slipFormat: string | null;
  slipResourceType: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "REVERSED";
  rejectionReason: string | null;
  transactionRef: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

type ApiData = {
  summary: { status: string; count: number }[];
  prefSummary: { pref: string; count: number }[];
  slips: Slip[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

const STATUS_TABS = ["PENDING", "APPROVED", "REJECTED", "REVERSED", "ALL"] as const;
type StatusTab = (typeof STATUS_TABS)[number];

// Settlement-preference tabs — split the queue by the retailer's Instant vs
// Next Day choice. "" = both.
const PREF_TABS = [
  { key: "", label: "All settlement" },
  { key: "INSTANT", label: "Instant" },
  { key: "T1", label: "Next day (T+1)" },
] as const;
type PrefTab = (typeof PREF_TABS)[number]["key"];

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function statusBadge(s: Slip["status"]) {
  if (s === "APPROVED") return <Badge variant="success">Approved</Badge>;
  if (s === "REJECTED") return <Badge variant="danger">Rejected</Badge>;
  if (s === "REVERSED") return <Badge variant="default">Reversed</Badge>;
  return <Badge variant="warning">Pending</Badge>;
}

export default function AdminPosSlipsPage() {
  const { session } = useAuth();
  // Approve/reject is MASTER_ADMIN / ADMIN only (mirrors the API guard). Finance
  // and Support get a read-only queue: they can view slips but not action them.
  const canReview = session?.role === "master-admin" || session?.role === "admin";

  const [tab, setTab] = useState<StatusTab>("PENDING");
  const [pref, setPref] = useState<PrefTab>("");
  const [data, setData] = useState<ApiData | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [actingId, setActingId] = useState<string | null>(null);

  const [approveTarget, setApproveTarget] = useState<Slip | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Slip | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [reverseTarget, setReverseTarget] = useState<Slip | null>(null);
  const [reverseReason, setReverseReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const prefQs = pref ? `&pref=${pref}` : "";
      const res = await fetch(`/api/admin/pos/manual-slips?status=${tab}${prefQs}&page=${page}&pageSize=25`);
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "Failed to load");
      setData(d);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load slips");
    } finally {
      setLoading(false);
    }
  }, [tab, pref, page]);

  useEffect(() => {
    load();
  }, [load]);

  const countByStatus = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of data?.summary ?? []) m.set(s.status, s.count);
    return m;
  }, [data]);

  const countByPref = useMemo(() => {
    const m = new Map<string, number>();
    let all = 0;
    for (const p of data?.prefSummary ?? []) { m.set(p.pref, p.count); all += p.count; }
    m.set("", all);
    return m;
  }, [data]);

  const approve = useCallback(async (slip: Slip) => {
    setActingId(slip.id);
    try {
      const res = await fetch(`/api/admin/pos/manual-slips/${slip.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof d.error === "string" ? d.error : "Approval failed");
      const net = d.settlement?.netAmount;
      const settledNow = d.settlement?.status === "SETTLED";
      toast.success(
        net != null
          ? settledNow
            ? `Approved — ₹${Number(net).toLocaleString("en-IN")} settled instantly to the retailer's wallet.`
            : `Approved — ₹${Number(net).toLocaleString("en-IN")} queued for the retailer's T+1 settlement.`
          : "Slip approved and pushed to settlement."
      );
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Approval failed");
    } finally {
      setActingId(null);
      setApproveTarget(null);
    }
  }, [load]);

  const reject = useCallback(async (slip: Slip, reason: string) => {
    setActingId(slip.id);
    try {
      const res = await fetch(`/api/admin/pos/manual-slips/${slip.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", reason }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof d.error === "string" ? d.error : "Rejection failed");
      toast.success("Slip rejected — the retailer will see the reason.");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rejection failed");
    } finally {
      setActingId(null);
      setRejectTarget(null);
      setRejectReason("");
    }
  }, [load]);

  const reverse = useCallback(async (slip: Slip, reason: string) => {
    setActingId(slip.id);
    try {
      const res = await fetch(`/api/admin/pos/manual-slips/${slip.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reverse", reason }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof d.error === "string" ? d.error : "Reversal failed");
      toast.success(
        d.reversal?.wasSettled
          ? "Reversed — flagged on the POS Reversals desk for wallet clawback (money was already settled)."
          : "Reversed — the pending settlement was cancelled; no money had moved."
      );
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reversal failed");
    } finally {
      setActingId(null);
      setReverseTarget(null);
      setReverseReason("");
    }
  }, [load]);

  const cols: Column<Slip>[] = [
    { key: "createdAt", header: "Uploaded", render: (r) => <span className="text-xs">{fmt(r.createdAt)}</span> },
    {
      key: "uploader",
      header: "Retailer",
      render: (r) => (
        <div className="flex flex-col">
          <span className="text-xs font-semibold text-ink-900">{r.uploader.name}</span>
          {r.uploader.userCode && <span className="text-[11px] text-brand-600">{r.uploader.userCode}</span>}
        </div>
      ),
    },
    { key: "tid", header: "TID", render: (r) => <span className="font-mono text-xs font-semibold">{r.tid}</span> },
    { key: "paymentMode", header: "Mode", render: (r) => <Badge variant="default">{r.paymentMode}</Badge> },
    {
      key: "settlementPref",
      header: "Settlement",
      render: (r) => (
        <Badge variant={r.settlementPref === "INSTANT" ? "accent" : "default"}>
          {r.settlementPref === "INSTANT" ? "Instant" : "Next day"}
        </Badge>
      ),
    },
    { key: "grossAmount", header: "Amount", align: "right", render: (r) => <span className="font-semibold">{formatINR(r.grossAmount)}</span> },
    { key: "rrn", header: "RRN / Auth", render: (r) => (
      <div className="flex flex-col text-xs font-mono">
        <span>{r.rrn ?? "—"}</span>
        {r.authCode && <span className="text-ink-500">auth {r.authCode}</span>}
      </div>
    ) },
    {
      key: "slipFormat",
      header: "Slip",
      render: (r) => (
        <a
          href={`/api/admin/pos/manual-slips/${r.id}/slip`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-ink-200 bg-white px-2 py-1 text-[11px] font-semibold text-ink-700 hover:bg-ink-50"
        >
          <FileText className="h-3 w-3" /> View <ExternalLink className="h-3 w-3" />
        </a>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <div className="flex flex-col gap-1">
          {statusBadge(r.status)}
          {(r.status === "REJECTED" || r.status === "REVERSED") && r.rejectionReason && (
            <span className="text-[11px] text-rose-600 max-w-[160px]">{r.rejectionReason}</span>
          )}
        </div>
      ),
    },
    {
      key: "id",
      header: canReview ? "Action" : "Review",
      render: (r) => {
        if (!canReview)
          return r.status === "PENDING" ? (
            <span className="text-xs text-ink-400">Awaiting admin review</span>
          ) : (
            <span className="text-xs text-ink-400">Reviewed {fmt(r.reviewedAt)}</span>
          );
        if (r.status === "PENDING")
          return (
            <div className="flex items-center gap-2">
              <Button size="sm" disabled={actingId === r.id} onClick={() => setApproveTarget(r)}>
                {actingId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={actingId === r.id}
                onClick={() => { setRejectTarget(r); setRejectReason(""); }}
              >
                <XCircle className="h-3.5 w-3.5" /> Reject
              </Button>
            </div>
          );
        // Approved slips can be reversed (rolls back the settlement via the
        // shared reversal engine — cancels a pending entry / flags a settled one).
        if (r.status === "APPROVED")
          return (
            <Button
              size="sm"
              variant="outline"
              disabled={actingId === r.id}
              onClick={() => { setReverseTarget(r); setReverseReason(""); }}
            >
              {actingId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
              Reverse
            </Button>
          );
        return <span className="text-xs text-ink-400">Reviewed {fmt(r.reviewedAt)}</span>;
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="External POS Slips"
        description="Verify retailer-uploaded transaction slips for External POS terminals (no live API, e.g. Yes Bank). Approving pushes the transaction into POS Fleet and the shared settlement engine (payin, MDR, instant/T+1, commission & TDS) exactly like an API-sourced capture."
        actions={
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        }
      />

      <div className="flex flex-wrap gap-1 rounded-xl border border-brand-100 bg-brand-50/50 p-1">
        {PREF_TABS.map((p) => (
          <button
            key={p.key || "ALL"}
            onClick={() => { setPref(p.key); setPage(1); }}
            className={
              "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all " +
              (pref === p.key ? "bg-white text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-700")
            }
          >
            {p.key === "INSTANT" ? <Zap className="h-4 w-4" /> : p.key === "T1" ? <CalendarClock className="h-4 w-4" /> : <ListChecks className="h-4 w-4" />}
            {p.label}
            {countByPref.has(p.key) && (
              <span className="rounded-full bg-ink-100 px-1.5 text-[11px] text-ink-600">{countByPref.get(p.key)}</span>
            )}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1 rounded-xl border border-ink-100 bg-ink-50/60 p-1">
        {STATUS_TABS.map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setPage(1); }}
            className={
              "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all " +
              (tab === t ? "bg-white text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-700")
            }
          >
            {t === "PENDING" ? <Clock className="h-4 w-4" /> : t === "APPROVED" ? <CheckCircle2 className="h-4 w-4" /> : t === "REJECTED" ? <XCircle className="h-4 w-4" /> : t === "REVERSED" ? <Undo2 className="h-4 w-4" /> : <ListChecks className="h-4 w-4" />}
            {t.charAt(0) + t.slice(1).toLowerCase()}
            {countByStatus.has(t) && (
              <span className="rounded-full bg-ink-100 px-1.5 text-[11px] text-ink-600">{countByStatus.get(t)}</span>
            )}
          </button>
        ))}
      </div>

      <DataTable
        title="Slip verification queue"
        description={data ? `${data.pagination.total} slip${data.pagination.total === 1 ? "" : "s"}` : "Loading..."}
        columns={cols}
        data={data?.slips ?? []}
        loading={loading}
        empty="No slips in this view."
      />

      {data && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Previous
          </Button>
          <span className="text-sm text-ink-600">Page {data.pagination.page} of {data.pagination.totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= data.pagination.totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={approveTarget !== null}
        onClose={() => setApproveTarget(null)}
        busy={approveTarget ? actingId === approveTarget.id : false}
        title="Approve this slip?"
        description={
          approveTarget && (
            <>
              <span className="font-semibold text-ink-900">{formatINR(approveTarget.grossAmount)}</span> on TID{" "}
              <span className="font-mono font-semibold text-ink-900">{approveTarget.tid}</span> for{" "}
              <span className="font-semibold text-ink-900">{approveTarget.uploader.name}</span> will be authorised — it
              will appear in POS Fleet and enter settlement (the retailer can then instant-settle or take T+1).
            </>
          )
        }
        confirmLabel="Approve & settle"
        onConfirm={() => { if (approveTarget) approve(approveTarget); }}
      />

      <ConfirmDialog
        open={rejectTarget !== null}
        onClose={() => { setRejectTarget(null); setRejectReason(""); }}
        busy={rejectTarget ? actingId === rejectTarget.id : false}
        title="Reject this slip?"
        description={
          rejectTarget && (
            <div className="space-y-3">
              <p>
                The retailer will see this reason and may re-upload. No money moves and it won&apos;t appear in POS
                Fleet.
              </p>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                placeholder="Reason (e.g. slip unreadable, amount mismatch, wrong TID)…"
                className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
              />
            </div>
          )
        }
        confirmLabel="Reject slip"
        onConfirm={() => {
          if (!rejectTarget) return;
          if (!rejectReason.trim()) {
            toast.error("Enter a rejection reason");
            return;
          }
          reject(rejectTarget, rejectReason.trim());
        }}
      />

      <ConfirmDialog
        open={reverseTarget !== null}
        onClose={() => { setReverseTarget(null); setReverseReason(""); }}
        busy={reverseTarget ? actingId === reverseTarget.id : false}
        title="Reverse this approved slip?"
        description={
          reverseTarget && (
            <div className="space-y-3">
              <p>
                This rolls back the settlement for{" "}
                <span className="font-semibold text-ink-900">{formatINR(reverseTarget.grossAmount)}</span> on TID{" "}
                <span className="font-mono font-semibold text-ink-900">{reverseTarget.tid}</span>. A pending (T+1)
                settlement is cancelled with no money movement; if it was already settled, the entry is reversed and
                flagged on the <span className="font-semibold">POS Reversals</span> desk for a manual wallet clawback
                (balances are never auto-debited). The transaction is removed from POS Fleet.
              </p>
              <textarea
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                rows={3}
                placeholder="Reason (e.g. duplicate slip, wrong amount, acquirer chargeback)…"
                className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
              />
            </div>
          )
        }
        confirmLabel="Reverse settlement"
        onConfirm={() => {
          if (!reverseTarget) return;
          if (!reverseReason.trim()) {
            toast.error("Enter a reversal reason");
            return;
          }
          reverse(reverseTarget, reverseReason.trim());
        }}
      />
    </div>
  );
}
