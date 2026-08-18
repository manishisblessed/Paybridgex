"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  QrCode,
  Clock,
  ShieldCheck,
  Banknote,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { StatTile, StatusPill, TabNav, SegmentedNav, type PillTone } from "@/components/dashboard/ui";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import { Input, Label } from "@/components/ui/Input";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";
import { formatINR } from "@/lib/utils";

type Overview = {
  pendingCount: number;
  pendingAmount: number;
  awaitingSecondCount: number;
  awaitingSecondAmount: number;
  settleableCount: number;
  settleableAmount: number;
  outstandingReceivableCount: number;
  outstandingReceivable: number;
};

type ClaimRow = {
  id: string;
  retailer: { id: string; userCode: string | null; name: string; phone: string; shopName: string | null };
  qrLabel: string;
  qrVpa: string | null;
  amount: number;
  utr: string | null;
  cardLast4: string | null;
  paidAt: string | null;
  status: "PENDING" | "AWAITING_SECOND_APPROVAL" | "APPROVED" | "SETTLEABLE" | "SETTLED" | "REJECTED" | "CLAWED_BACK";
  reviewNote: string | null;
  firstApprovedById: string | null;
  firstApprovedBy: string | null;
  firstApprovedByCode: string | null;
  firstApprovedAt: string | null;
  reviewedById: string | null;
  reviewedBy: string | null;
  reviewedByCode: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

/** UTR when present, else the RuPay card's last 4 (card collections have no UTR). */
function claimIdentifier(row: { utr: string | null; cardLast4: string | null }): string {
  if (row.utr) return row.utr;
  if (row.cardLast4) return `•••• ${row.cardLast4}`;
  return "—";
}

type QrState = "LIVE" | "QUEUED" | "FULL_TODAY" | "DISABLED";

type QrRow = {
  id: string;
  label: string;
  upiVpa: string | null;
  imageUrl: string;
  active: boolean;
  enabled: boolean;
  priority: number;
  dailyLimit: number | null;
  dailyLimitCount: number | null;
  collectedToday: number;
  collectedTodayCount: number;
  state: QrState;
  claimCount: number;
  createdBy: string;
  createdAt: string;
  disabledAt: string | null;
};

// ---------------------------------------------------------------------------
// Tab 1 — claims review queue
// ---------------------------------------------------------------------------

function ReviewQueueTab() {
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [threshold, setThreshold] = useState(10000);
  const [statusFilter, setStatusFilter] = useState<"REVIEWABLE" | "ALL">("REVIEWABLE");
  const [loading, setLoading] = useState(true);

  // Review panel state
  const [selected, setSelected] = useState<ClaimRow | null>(null);
  const [portalVerified, setPortalVerified] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/qr/claims?status=${statusFilter}`);
      if (res.ok) {
        const d = await res.json();
        setClaims(d.claims ?? []);
        setOverview(d.overview ?? null);
        if (d.secondApprovalThreshold) setThreshold(d.secondApprovalThreshold);
      }
    } catch {
      toast.error("Could not load the review queue.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function openReview(c: ClaimRow) {
    setSelected(c);
    setPortalVerified(false);
    setNote("");
  }

  async function act(action: "approve" | "reject") {
    if (!selected) return;
    if (action === "reject" && note.trim().length < 3) {
      toast.error("A rejection note is required (shown to the retailer).");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/qr/claims/${selected.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "approve" ? { portalVerified, note: note.trim() || undefined } : { note: note.trim() }
        ),
      });
      const d = await res.json();
      if (!res.ok) {
        toast.error(typeof d.error === "string" ? d.error : "Action failed");
        return;
      }
      if (d.status === "SETTLEABLE") {
        toast.success(
          `Approved — ${formatINR(selected.amount)} is now settleable to ${selected.retailer.name}. They receive it (net of MDR) on instant settle or T+1.`
        );
      } else if (d.status === "AWAITING_SECOND_APPROVAL") {
        toast.warning(
          `First approval recorded — a DIFFERENT admin must approve this ${formatINR(selected.amount)} claim before money moves.`
        );
      } else {
        toast.success("Claim rejected.");
      }
      setSelected(null);
      refresh();
    } catch {
      toast.error("Network error — refresh the queue before retrying.");
    } finally {
      setBusy(false);
    }
  }

  const cols: Column<ClaimRow>[] = [
    {
      key: "retailer",
      header: "Retailer",
      render: (r) => (
        <div>
          <div className="font-medium">
            {r.retailer.name}
            {r.retailer.userCode && <span className="ml-2 font-medium text-brand-600">{r.retailer.userCode}</span>}
          </div>
          <div className="text-xs text-ink-500">{r.retailer.shopName ?? r.retailer.phone}</div>
        </div>
      ),
    },
    { key: "utr", header: "UTR / Card", render: (r) => <span className="font-mono text-xs">{claimIdentifier(r)}</span> },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (r) => (
        <div>
          <span className="font-semibold">{formatINR(r.amount)}</span>
          {r.amount > threshold && (
            <div className="text-[10px] font-semibold uppercase text-violet-600">2-admin</div>
          )}
        </div>
      ),
    },
    {
      key: "paidAt",
      header: "Paid at",
      render: (r) =>
        r.paidAt ? new Date(r.paidAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—",
    },
    {
      key: "status",
      header: "Status",
      render: (r) => {
        const tone: PillTone =
          r.status === "SETTLED" || r.status === "APPROVED" || r.status === "SETTLEABLE"
            ? "success"
            : r.status === "PENDING"
              ? "warning"
              : r.status === "AWAITING_SECOND_APPROVAL"
                ? "violet"
                : "danger";
        const label =
          r.status === "AWAITING_SECOND_APPROVAL"
            ? "NEEDS 2ND APPROVAL"
            : r.status === "SETTLEABLE"
              ? "READY TO SETTLE"
              : r.status;
        return (
          <div>
            <StatusPill status={r.status} tone={tone}>{label}</StatusPill>
          </div>
        );
      },
    },
    {
      key: "reviewedById",
      header: "Approved by",
      render: (r) => {
        const hasChecker = Boolean(r.reviewedBy || r.reviewedById);
        const hasMaker = Boolean(r.firstApprovedBy || r.firstApprovedById);
        if (!hasChecker && !hasMaker) return <span className="text-xs text-ink-400">—</span>;
        return (
          <div className="space-y-1 text-xs">
            {hasMaker && (
              <div>
                <span className="text-ink-400">1st: </span>
                <span className="font-medium text-ink-700">{r.firstApprovedBy ?? "—"}</span>
                {r.firstApprovedByCode && <span className="ml-1 font-mono text-ink-500">({r.firstApprovedByCode})</span>}
                {r.firstApprovedAt && (
                  <span className="ml-1 text-ink-400">
                    {new Date(r.firstApprovedAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                  </span>
                )}
              </div>
            )}
            {hasChecker && (
              <div>
                {hasMaker && <span className="text-ink-400">2nd: </span>}
                <span className="font-medium text-ink-700">{r.reviewedBy ?? "—"}</span>
                {r.reviewedByCode && <span className="ml-1 font-mono text-ink-500">({r.reviewedByCode})</span>}
                {r.reviewedAt && (
                  <span className="ml-1 text-ink-400">
                    {new Date(r.reviewedAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                  </span>
                )}
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: "screenshot",
      header: "Proof",
      align: "right",
      render: (r) => (
        <a
          href={`/api/admin/qr/claims/${r.id}/screenshot`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-2.5 py-1 text-xs font-semibold text-ink-700 hover:border-ink-300"
          title="Open the payment screenshot"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          View
        </a>
      ),
    },
    {
      key: "id",
      header: "",
      align: "right",
      render: (r) =>
        r.status === "PENDING" || r.status === "AWAITING_SECOND_APPROVAL" ? (
          <Button variant="outline" onClick={() => openReview(r)} className="h-8 px-3 text-xs">
            Review
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      {overview && (
        <Stagger stagger={0.05} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StaggerItem distance={14} duration={0.35}>
            <StatTile
              label="Pending review"
              value={`${overview.pendingCount + overview.awaitingSecondCount} · ${formatINR(overview.pendingAmount + overview.awaitingSecondAmount)}`}
              icon={Clock}
              tone="amber"
            />
          </StaggerItem>
          <StaggerItem distance={14} duration={0.35}>
            <StatTile
              label="Needs 2nd approval"
              value={`${overview.awaitingSecondCount} · ${formatINR(overview.awaitingSecondAmount)}`}
              icon={ShieldCheck}
              tone="violet"
            />
          </StaggerItem>
          <StaggerItem distance={14} duration={0.35}>
            <StatTile
              label="Outstanding receivable (credited, unsettled by provider)"
              value={formatINR(overview.outstandingReceivable)}
              icon={Banknote}
              tone="brand"
            />
          </StaggerItem>
        </Stagger>
      )}

      {/* Review panel */}
      {selected && (
        <div className="rounded-2xl border-2 border-brand-200 bg-white p-6 shadow-soft">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-ink-500">Reviewing claim</p>
              <p className="mt-1 font-display text-xl font-bold text-ink-900">
                {formatINR(selected.amount)} · {selected.utr ? "UTR" : "Card"}{" "}
                <span className="font-mono">{claimIdentifier(selected)}</span>
              </p>
              <p className="mt-1 text-sm text-ink-600">
                {selected.retailer.name} ({selected.retailer.shopName ?? selected.retailer.phone})
                {selected.paidAt ? (
                  <>
                    {" "}
                    · paid{" "}
                    {new Date(selected.paidAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                  </>
                ) : null}{" "}
                on {selected.qrLabel}
                {selected.qrVpa ? (
                  <>
                    {" "}
                    → <span className="font-mono">{selected.qrVpa}</span>
                  </>
                ) : null}
              </p>
              {selected.cardLast4 && (
                <p className="mt-1 text-sm text-ink-600">
                  RuPay card: <span className="font-mono font-semibold">•••• {selected.cardLast4}</span>
                  {selected.utr ? <span className="ml-2 text-ink-400">UTR {selected.utr}</span> : null}
                </p>
              )}
              {selected.status === "AWAITING_SECOND_APPROVAL" && (
                <p className="mt-2 rounded-lg bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700">
                  Second approval — must be a different admin than the first approver
                  {selected.firstApprovedBy
                    ? ` (${selected.firstApprovedBy}${selected.firstApprovedByCode ? ` · ${selected.firstApprovedByCode}` : ""})`
                    : ""}
                  .
                </p>
              )}
            </div>
            <a
              href={`/api/admin/qr/claims/${selected.id}/screenshot`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-ink-200 px-4 py-2.5 text-sm font-semibold text-ink-700 hover:border-ink-300"
            >
              <ExternalLink className="h-4 w-4" />
              Open screenshot
            </a>
          </div>

          <div className="mt-4 space-y-3 rounded-xl bg-ink-50/60 p-4">
            <p className="text-xs font-semibold text-ink-700">Verification checklist</p>
            <ul className="space-y-1 text-xs text-ink-600">
              <li>1. Screenshot shows a SUCCESSFUL payment to the correct VPA{selected.qrVpa ? ` (${selected.qrVpa})` : ""}.</li>
              <li>2. Amount, card last-4{selected.utr ? ", UTR" : ""} and any date/time typed above match what is visible in the image.</li>
              <li>3. The payment exists in the provider&apos;s merchant portal with the same amount.</li>
            </ul>
            <label className="flex items-start gap-2 rounded-xl border border-ink-200 bg-white p-3 text-sm">
              <input
                type="checkbox"
                checked={portalVerified}
                onChange={(e) => setPortalVerified(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-brand-600"
              />
              <span>
                I verified this UTR and amount in the <strong>provider&apos;s merchant portal</strong>. This
                attestation is recorded against my account in the audit log.
              </span>
            </label>
            <div>
              <Label htmlFor="review-note">Note {`(required to reject)`}</Label>
              <Input
                id="review-note"
                value={note}
                maxLength={500}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Verified in portal / UTR not found in portal"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => act("approve")} disabled={busy || !portalVerified}>
                <CheckCircle2 className="mr-1 h-4 w-4" />
                {busy
                  ? "Working…"
                  : selected.amount > threshold && selected.status === "PENDING"
                    ? "Approve (stage for 2nd admin)"
                    : `Approve ${formatINR(selected.amount)}`}
              </Button>
              <Button variant="outline" onClick={() => act("reject")} disabled={busy}>
                <XCircle className="mr-1 h-4 w-4" />
                Reject
              </Button>
              <Button variant="ghost" onClick={() => setSelected(null)} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <SegmentedNav
          tabs={[
            { key: "REVIEWABLE", label: "Awaiting action" },
            { key: "ALL", label: "All claims" },
          ]}
          active={statusFilter}
          onChange={(key) => setStatusFilter(key as "REVIEWABLE" | "ALL")}
        />
        <Button variant="outline" onClick={refresh} disabled={loading} className="h-8 px-2">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <Reveal distance={16} duration={0.45}>
        <DataTable
          title="Claims (oldest first)"
          loading={loading}
          columns={cols}
          data={claims}
          empty="Nothing awaiting review."
        />
      </Reveal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 2 — static QR management
// ---------------------------------------------------------------------------

const QR_STATE_BADGE: Record<QrState, { tone: PillTone; label: string }> = {
  LIVE: { tone: "success", label: "Live" },
  QUEUED: { tone: "brand", label: "Queued" },
  FULL_TODAY: { tone: "warning", label: "Full today" },
  DISABLED: { tone: "neutral", label: "Disabled" },
};

function QrManageTab() {
  const [qrs, setQrs] = useState<QrRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [label, setLabel] = useState("");
  const [vpa, setVpa] = useState("");
  const [priority, setPriority] = useState("100");
  const [dailyLimit, setDailyLimit] = useState("");
  const [dailyLimitCount, setDailyLimitCount] = useState("");
  const [image, setImage] = useState<{ name: string; dataUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [toggleTarget, setToggleTarget] = useState<QrRow | null>(null);
  const [toggleBusy, setToggleBusy] = useState(false);
  const [liveTarget, setLiveTarget] = useState<QrRow | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);

  const [editTarget, setEditTarget] = useState<QrRow | null>(null);
  const [editPriority, setEditPriority] = useState("");
  const [editLimit, setEditLimit] = useState("");
  const [editCount, setEditCount] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/qr");
      if (res.ok) setQrs((await res.json()).qrs ?? []);
    } catch {
      toast.error("Could not load QR codes.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("QR image must be under 5 MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImage({ name: file.name, dataUrl: String(reader.result) });
    reader.readAsDataURL(file);
  }

  async function submitQr(e: React.FormEvent) {
    e.preventDefault();
    if (!image) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/qr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim(),
          upiVpa: vpa.trim() || undefined,
          priority: priority.trim() ? Number(priority) : undefined,
          dailyLimit: dailyLimit.trim() ? Number(dailyLimit) : undefined,
          dailyLimitCount: dailyLimitCount.trim() ? Number(dailyLimitCount) : undefined,
          dataUrl: image.dataUrl,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        toast.error(typeof d.error === "string" ? d.error : "Upload failed — check the fields");
        return;
      }
      toast.success(d.active ? `"${d.label}" is now the live QR.` : `"${d.label}" added to the queue (priority ${d.priority}).`);
      setLabel("");
      setVpa("");
      setPriority("100");
      setDailyLimit("");
      setDailyLimitCount("");
      setImage(null);
      if (fileRef.current) fileRef.current.value = "";
      refresh();
    } catch {
      toast.error("Network error while uploading the QR.");
    } finally {
      setBusy(false);
    }
  }

  async function patchQr(id: string, body: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(`/api/admin/qr/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast.error(typeof d.error === "string" ? d.error : "Could not update the QR");
      return false;
    }
    return true;
  }

  async function toggle(qr: QrRow) {
    setToggleBusy(true);
    try {
      if (await patchQr(qr.id, { enabled: !qr.enabled })) {
        toast.success(qr.enabled ? "QR removed from the queue." : "QR added back to the queue.");
        refresh();
      }
    } finally {
      setToggleBusy(false);
    }
  }

  async function makeLive(qr: QrRow) {
    setLiveBusy(true);
    try {
      if (await patchQr(qr.id, { makeLiveNow: true })) {
        toast.success(`"${qr.label}" is now live for all retailers.`);
        refresh();
      }
    } finally {
      setLiveBusy(false);
    }
  }

  function openEdit(qr: QrRow) {
    setEditPriority(String(qr.priority));
    setEditLimit(qr.dailyLimit != null ? String(qr.dailyLimit) : "");
    setEditCount(qr.dailyLimitCount != null ? String(qr.dailyLimitCount) : "");
    setEditTarget(qr);
  }

  async function saveEdit() {
    if (!editTarget) return;
    setEditBusy(true);
    try {
      const ok = await patchQr(editTarget.id, {
        priority: editPriority.trim() ? Number(editPriority) : undefined,
        dailyLimit: editLimit.trim() ? Number(editLimit) : null,
        dailyLimitCount: editCount.trim() ? Number(editCount) : null,
      });
      if (ok) {
        toast.success("QR limits updated.");
        setEditTarget(null);
        refresh();
      }
    } finally {
      setEditBusy(false);
    }
  }

  const cols: Column<QrRow>[] = [
    {
      key: "imageUrl",
      header: "QR",
      render: (r) => (
        <a href={r.imageUrl} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={r.imageUrl} alt={r.label} className="h-12 w-12 rounded-lg border border-ink-100 object-cover" />
        </a>
      ),
    },
    {
      key: "label",
      header: "Label",
      render: (r) => (
        <div>
          <div className="font-medium text-ink-900">{r.label}</div>
          {r.upiVpa && <div className="font-mono text-xs text-ink-500">{r.upiVpa}</div>}
        </div>
      ),
    },
    { key: "priority", header: "Priority", align: "right" },
    {
      key: "collectedToday",
      header: "Today",
      align: "right",
      render: (r) => {
        const pct = r.dailyLimit != null && r.dailyLimit > 0 ? Math.min(100, (r.collectedToday / r.dailyLimit) * 100) : 0;
        return (
          <div className="ml-auto w-28">
            <div className="text-sm font-medium text-ink-900">
              {formatINR(r.collectedToday)}
              <span className="text-ink-400"> / {r.dailyLimit != null ? formatINR(r.dailyLimit) : "∞"}</span>
            </div>
            {r.dailyLimitCount != null && (
              <div className="text-xs text-ink-500">
                {r.collectedTodayCount}/{r.dailyLimitCount} txns
              </div>
            )}
            {r.dailyLimit != null && (
              <div className="mt-1 h-1 w-full rounded-full bg-ink-100">
                <div
                  className={`h-1 rounded-full ${pct >= 100 ? "bg-amber-500" : "bg-brand-500"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}
          </div>
        );
      },
    },
    { key: "claimCount", header: "Claims", align: "right" },
    {
      key: "state",
      header: "Status",
      render: (r) => {
        const b = QR_STATE_BADGE[r.state];
        return <StatusPill status={r.state} tone={b.tone}>{b.label}</StatusPill>;
      },
    },
    {
      key: "createdAt",
      header: "Uploaded",
      render: (r) => (
        <div>
          <div>{new Date(r.createdAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}</div>
          <div className="text-xs text-ink-500">by {r.createdBy}</div>
        </div>
      ),
    },
    {
      key: "id",
      header: "",
      align: "right",
      render: (r) => (
        <div className="flex justify-end gap-2">
          {r.enabled && r.state !== "LIVE" && (
            <Button variant="outline" onClick={() => setLiveTarget(r)} className="h-8 px-3 text-xs">
              Make live
            </Button>
          )}
          <Button variant="outline" onClick={() => openEdit(r)} className="h-8 px-3 text-xs">
            Edit
          </Button>
          <Button variant="outline" onClick={() => setToggleTarget(r)} className="h-8 px-3 text-xs">
            {r.enabled ? "Disable" : "Enable"}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">

      <form onSubmit={submitQr} className="rounded-2xl border border-ink-100 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white">
            <QrCode className="h-4 w-4" />
          </span>
          <div>
            <h3 className="font-display text-base font-semibold text-ink-900">Add a QR to the collection queue</h3>
            <p className="text-xs text-ink-500">
              Retailers see remaining rupees on the live QR and the next QR for overflow. When a QR hits its daily
              limit it auto-pauses and the next one takes over; limits reset every day (IST).
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label htmlFor="qr-label">Label</Label>
            <Input
              id="qr-label"
              required
              minLength={2}
              maxLength={120}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Provider QR — July 2026"
            />
          </div>
          <div>
            <Label htmlFor="qr-vpa">UPI VPA in the QR (recommended)</Label>
            <Input
              id="qr-vpa"
              value={vpa}
              onChange={(e) => setVpa(e.target.value)}
              placeholder="merchant@bank"
            />
            <p className="mt-1 text-xs text-ink-500">Shown to reviewers to eyeball-match screenshots.</p>
          </div>
          <div>
            <Label htmlFor="qr-priority">Priority</Label>
            <Input
              id="qr-priority"
              type="number"
              min={0}
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              placeholder="100"
            />
            <p className="mt-1 text-xs text-ink-500">Lower number = collected first.</p>
          </div>
          <div>
            <Label htmlFor="qr-limit">Daily limit (₹)</Label>
            <Input
              id="qr-limit"
              type="number"
              min={1}
              value={dailyLimit}
              onChange={(e) => setDailyLimit(e.target.value)}
              placeholder="e.g. 200000 (blank = unlimited)"
            />
            <p className="mt-1 text-xs text-ink-500">Auto-switches to the next QR once reached.</p>
          </div>
          <div>
            <Label htmlFor="qr-count">Max transactions / day</Label>
            <Input
              id="qr-count"
              type="number"
              min={1}
              value={dailyLimitCount}
              onChange={(e) => setDailyLimitCount(e.target.value)}
              placeholder="optional"
            />
          </div>
          <div>
            <Label htmlFor="qr-image">QR image (PNG/JPEG/WebP)</Label>
            <input
              id="qr-image"
              ref={fileRef}
              type="file"
              required
              accept="image/png,image/jpeg,image/webp"
              onChange={pickFile}
              className="block w-full rounded-xl border border-ink-200 bg-white px-4 py-2 text-sm text-ink-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-brand-700"
            />
            {image && <p className="mt-1 text-xs text-emerald-600">Attached: {image.name}</p>}
          </div>
        </div>

        <Button type="submit" className="mt-4" disabled={busy || !image || !label.trim()} isLoading={busy}>
          Add to queue
        </Button>
      </form>

      <Reveal distance={16} duration={0.45}>
        <DataTable
          title="QR queue"
          loading={loading}
          description="Ordered by priority. Retailers see remaining headroom on the live QR and collect overflow on the next one; full QRs auto-resume tomorrow. Old QRs are never deleted so historical claims stay traceable."
          columns={cols}
          data={qrs}
          empty="No QR uploaded yet — retailers currently have nothing to collect on."
        />
      </Reveal>

      <ConfirmDialog
        open={liveTarget !== null}
        onClose={() => setLiveTarget(null)}
        busy={liveBusy}
        tone="default"
        title="Make this QR live now?"
        description="It jumps to the top of the queue and every retailer collects on it immediately (today's auto-pause, if any, is cleared)."
        confirmLabel="Make live"
        onConfirm={async () => {
          if (!liveTarget) return;
          await makeLive(liveTarget);
          setLiveTarget(null);
        }}
      />

      <ConfirmDialog
        open={toggleTarget !== null}
        onClose={() => setToggleTarget(null)}
        busy={toggleBusy}
        title={toggleTarget?.enabled ? "Remove this QR from the queue?" : "Add this QR back to the queue?"}
        description={
          toggleTarget?.enabled
            ? "Retailers will no longer be routed to it. If it was live, the next-priority QR takes over."
            : "It rejoins the queue at its priority and can be selected again."
        }
        confirmLabel={toggleTarget?.enabled ? "Disable" : "Enable"}
        onConfirm={async () => {
          if (!toggleTarget) return;
          await toggle(toggleTarget);
          setToggleTarget(null);
        }}
      />

      <Modal
        open={editTarget !== null}
        onClose={() => (editBusy ? undefined : setEditTarget(null))}
        eyebrow="QR settings"
        title={editTarget?.label}
        subtitle="Priority and daily caps. Blank limit = unlimited."
        size="sm"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setEditTarget(null)} disabled={editBusy}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={saveEdit} isLoading={editBusy} disabled={editBusy}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="edit-priority">Priority</Label>
            <Input
              id="edit-priority"
              type="number"
              min={0}
              value={editPriority}
              onChange={(e) => setEditPriority(e.target.value)}
            />
            <p className="mt-1 text-xs text-ink-500">Lower number = collected first.</p>
          </div>
          <div>
            <Label htmlFor="edit-limit">Daily limit (₹)</Label>
            <Input
              id="edit-limit"
              type="number"
              min={1}
              value={editLimit}
              onChange={(e) => setEditLimit(e.target.value)}
              placeholder="blank = unlimited"
            />
          </div>
          <div>
            <Label htmlFor="edit-count">Max transactions / day</Label>
            <Input
              id="edit-count"
              type="number"
              min={1}
              value={editCount}
              onChange={(e) => setEditCount(e.target.value)}
              placeholder="blank = unlimited"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function AdminQrPage() {
  const [tab, setTab] = useState<"queue" | "manage">("queue");

  return (
    <div className="space-y-6">
      <Reveal distance={14} duration={0.4}>
        <PageHeader
          eyebrow="Admin"
          title="QR Collections"
          description="Manage the shop collection QR and verify retailer settlement claims. Money moves only after the UTR is confirmed in the provider portal."
        />
      </Reveal>

      <TabNav
        tabs={[
          { key: "queue", label: "Review queue", icon: ShieldCheck },
          { key: "manage", label: "QR codes", icon: QrCode },
        ]}
        active={tab}
        onChange={(key) => setTab(key as "queue" | "manage")}
      />

      {tab === "queue" ? <ReviewQueueTab /> : <QrManageTab />}
    </div>
  );
}
