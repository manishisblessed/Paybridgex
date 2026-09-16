"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  Truck, PackageCheck, CheckCircle2, Clock, XCircle, Loader2, RefreshCw,
  Monitor, MapPin, ShoppingCart, Search, Download,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { StatCard } from "@/components/dashboard/StatCard";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { formatINR } from "@/lib/utils";
import { useStepUp } from "@/components/security/StepUpProvider";

type BookingStatus = "APPLIED" | "ASSIGNED" | "DISPATCHED" | "DELIVERED" | "CANCELLED";

type Booking = {
  id: string;
  status: BookingStatus;
  statusLabel: string;
  deliveryAddress: string;
  contactName: string | null;
  contactPhone: string | null;
  amountPaid: number;
  monthlyRent: number;
  includeGst: boolean;
  deposit: number;
  setupFee: number;
  billingDay: number;
  courier: string | null;
  trackingRef: string | null;
  createdAt: string;
  plan: { id: string; name: string };
  machine: { id: string; tid: string | null; serial: string | null; model: string | null } | null;
  user: { id: string; name: string; email: string; phone: string; role: string; userCode: string | null; shopName: string | null };
  events: { id: string; status: BookingStatus; note: string | null; createdAt: string }[];
};

type MachineOption = { id: string; tid: string | null; serial: string | null; model: string | null; provider: string };

type QueueData = {
  bookings: Booking[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<string, number>;
  machines: MachineOption[];
};

async function fetcher(url: string): Promise<QueueData> {
  const r = await fetch(url);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof d?.error === "string" ? d.error : "Failed to load");
  return d as QueueData;
}

const TABS: { key: BookingStatus | "ALL"; label: string; icon: typeof Clock }[] = [
  { key: "APPLIED", label: "New (Applied)", icon: ShoppingCart },
  { key: "ASSIGNED", label: "Assigned", icon: CheckCircle2 },
  { key: "DISPATCHED", label: "Dispatched", icon: Truck },
  { key: "DELIVERED", label: "Delivered", icon: PackageCheck },
  { key: "CANCELLED", label: "Cancelled", icon: XCircle },
  { key: "ALL", label: "All", icon: Monitor },
];

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function statusBadge(status: BookingStatus, label: string) {
  const v: Record<BookingStatus, "success" | "warning" | "danger" | "brand" | "default" | "accent"> = {
    APPLIED: "warning", ASSIGNED: "brand", DISPATCHED: "accent", DELIVERED: "success", CANCELLED: "danger",
  };
  return <Badge variant={v[status] ?? "default"}>{label}</Badge>;
}

export default function AdminPosBookingsPage() {
  const [tab, setTab] = useState<BookingStatus | "ALL">("APPLIED");
  const [page, setPage] = useState(1);
  const { fetchWithStepUp } = useStepUp();

  const query = `/api/admin/pos/booking?page=${page}${tab === "ALL" ? "" : `&status=${tab}`}`;
  const { data, error, isLoading, mutate } = useSWR<QueueData>(query, fetcher, {
    revalidateOnFocus: true, refreshInterval: 20000, keepPreviousData: true,
  });

  const [assignTarget, setAssignTarget] = useState<Booking | null>(null);
  const [dispatchTarget, setDispatchTarget] = useState<Booking | null>(null);
  const [deliverTarget, setDeliverTarget] = useState<Booking | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  const counts = data?.counts ?? {};
  const bookings = data?.bookings ?? [];
  const machines = data?.machines ?? [];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const act = async (body: Record<string, unknown>): Promise<boolean> => {
    setBusy(true);
    try {
      const res = await fetchWithStepUp("/api/admin/pos/booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof d?.error === "string" ? d.error : "Action failed");
      mutate();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/admin/pos/booking?all=1${tab === "ALL" ? "" : `&status=${tab}`}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof d?.error === "string" ? d.error : "Export failed");
      const rows: Booking[] = d.bookings ?? [];
      if (rows.length === 0) { toast.error("Nothing to export in this view."); return; }
      downloadBookingsCsv(rows, `pos-bookings-${tab.toLowerCase()}-${new Date().toISOString().slice(0, 10)}`);
      toast.success(`Exported ${rows.length} booking${rows.length === 1 ? "" : "s"}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="POS Bookings"
        description="Fulfil retailer POS machine bookings — assign a machine, dispatch it and confirm delivery. Cancelling refunds the applicant automatically."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={exporting} onClick={exportCsv}>
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Export CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => mutate()}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="New / Applied" value={String(counts.APPLIED ?? 0)} icon={ShoppingCart} accent="accent" />
        <StatCard label="Assigned" value={String(counts.ASSIGNED ?? 0)} icon={CheckCircle2} accent="brand" />
        <StatCard label="Dispatched" value={String(counts.DISPATCHED ?? 0)} icon={Truck} accent="violet" />
        <StatCard label="Delivered" value={String(counts.DELIVERED ?? 0)} icon={PackageCheck} accent="emerald" />
        <StatCard label="Cancelled" value={String(counts.CANCELLED ?? 0)} icon={XCircle} accent="accent" />
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 rounded-xl border border-ink-100 bg-ink-50/60 p-1">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => { setTab(key); setPage(1); }}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-all ${
              tab === key ? "bg-white text-ink-900 shadow-sm ring-1 ring-ink-100" : "text-ink-500 hover:text-ink-700"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
            {key !== "ALL" && counts[key] ? (
              <span className="rounded-full bg-brand-100 px-1.5 text-[10px] font-bold text-brand-700">{counts[key]}</span>
            ) : null}
          </button>
        ))}
      </div>

      {error ? (
        <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          <XCircle className="h-4 w-4 shrink-0" /> {error instanceof Error ? error.message : "Failed to load bookings."}
        </div>
      ) : isLoading && bookings.length === 0 ? (
        <div className="flex items-center gap-2 rounded-2xl border border-ink-100 bg-white p-6 text-sm text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading bookings…
        </div>
      ) : bookings.length === 0 ? (
        <div className="rounded-2xl border border-ink-200 bg-ink-50 p-8 text-center text-sm text-ink-600">
          No bookings in this view.
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map((b) => (
            <div key={b.id} className="rounded-2xl border border-ink-100 bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-ink-900">{b.user.name}</h3>
                    <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-ink-600">{b.user.role.toLowerCase()}</span>
                    {statusBadge(b.status, b.statusLabel)}
                  </div>
                  <p className="mt-0.5 text-xs text-ink-400">
                    {[b.user.shopName, b.user.userCode, b.user.phone].filter(Boolean).join(" · ")} · #{b.id.slice(-8).toUpperCase()}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Paid</p>
                  <p className="text-lg font-bold text-ink-900">{formatINR(b.amountPaid)}</p>
                  <p className="text-[11px] text-ink-400">{fmtDateTime(b.createdAt)}</p>
                </div>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Info icon={ShoppingCart} label="Plan">
                  <p className="text-sm font-medium text-ink-800">{b.plan.name}</p>
                  <p className="text-xs text-ink-500">{formatINR(b.monthlyRent)}/mo{b.includeGst ? " + GST" : ""} · bills on day {b.billingDay}</p>
                </Info>
                <Info icon={MapPin} label="Delivery address">
                  <p className="text-sm text-ink-700">{b.deliveryAddress}</p>
                  {(b.contactName || b.contactPhone) && (
                    <p className="text-xs text-ink-500">{[b.contactName, b.contactPhone].filter(Boolean).join(" · ")}</p>
                  )}
                </Info>
                <Info icon={Monitor} label="Machine">
                  {b.machine ? (
                    <>
                      <p className="font-mono text-sm font-semibold text-ink-800">{b.machine.tid ?? b.machine.serial ?? b.machine.id.slice(0, 8)}</p>
                      <p className="text-xs text-ink-500">{b.machine.model ?? ""}</p>
                    </>
                  ) : (
                    <p className="text-sm text-ink-500">Not allocated</p>
                  )}
                  {b.trackingRef && <p className="text-xs text-ink-500">Track: {b.courier ? `${b.courier} · ` : ""}{b.trackingRef}</p>}
                </Info>
              </div>

              {/* Actions */}
              <div className="mt-4 flex flex-wrap gap-2 border-t border-ink-50 pt-3">
                {b.status === "APPLIED" && (
                  <Button size="sm" disabled={busy} onClick={() => setAssignTarget(b)}>
                    <CheckCircle2 className="h-4 w-4" /> Assign machine
                  </Button>
                )}
                {b.status === "ASSIGNED" && (
                  <Button size="sm" disabled={busy} onClick={() => setDispatchTarget(b)}>
                    <Truck className="h-4 w-4" /> Mark dispatched
                  </Button>
                )}
                {b.status === "DISPATCHED" && (
                  <Button size="sm" disabled={busy} onClick={() => setDeliverTarget(b)}>
                    <PackageCheck className="h-4 w-4" /> Mark delivered
                  </Button>
                )}
                {(b.status === "APPLIED" || b.status === "ASSIGNED" || b.status === "DISPATCHED") && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => setCancelTarget(b)}>
                    <XCircle className="h-4 w-4" /> Cancel & refund
                  </Button>
                )}
                {b.events.length > 0 && (
                  <details className="ml-auto">
                    <summary className="cursor-pointer text-xs font-semibold text-brand-600 hover:text-brand-800">Timeline</summary>
                    <ol className="relative mt-2 ml-2 space-y-2 border-l border-ink-200 pl-4">
                      {b.events.map((e) => (
                        <li key={e.id} className="relative">
                          <span className="absolute -left-[22px] top-1 h-2 w-2 rounded-full bg-brand-500" />
                          <p className="text-xs font-medium text-ink-700">{e.status.charAt(0) + e.status.slice(1).toLowerCase()}{e.note ? ` — ${e.note}` : ""}</p>
                          <p className="text-[11px] text-ink-400">{fmtDateTime(e.createdAt)}</p>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-ink-500">
          <span>Page {page} of {pages}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      <AssignModal
        booking={assignTarget}
        machines={machines}
        busy={busy}
        onClose={() => setAssignTarget(null)}
        onAssign={async (machineId) => {
          const ok = await act({ action: "assign", bookingId: assignTarget!.id, machineId });
          if (ok) { toast.success("Machine assigned."); setAssignTarget(null); }
        }}
      />

      <DispatchModal
        booking={dispatchTarget}
        busy={busy}
        onClose={() => setDispatchTarget(null)}
        onDispatch={async (courier, trackingRef) => {
          const ok = await act({ action: "dispatch", bookingId: dispatchTarget!.id, courier, trackingRef });
          if (ok) { toast.success("Marked dispatched."); setDispatchTarget(null); }
        }}
      />

      <ConfirmDialog
        open={deliverTarget !== null}
        onClose={() => setDeliverTarget(null)}
        busy={busy}
        title="Mark as delivered?"
        description={deliverTarget && <>Confirm that <span className="font-semibold text-ink-900">{deliverTarget.user.name}</span> has received the machine. This completes the booking.</>}
        confirmLabel="Mark delivered"
        onConfirm={async () => {
          const ok = await act({ action: "deliver", bookingId: deliverTarget!.id });
          if (ok) { toast.success("Marked delivered."); setDeliverTarget(null); }
        }}
      />

      <ConfirmDialog
        open={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        busy={busy}
        tone="danger"
        title="Cancel this booking?"
        description={cancelTarget && (
          <>
            <span className="font-semibold text-ink-900">{formatINR(cancelTarget.amountPaid)}</span> will be refunded to{" "}
            <span className="font-semibold text-ink-900">{cancelTarget.user.name}</span>&apos;s wallet
            {cancelTarget.machine ? ", and the allocated machine returns to stock" : ""}.
          </>
        )}
        confirmLabel="Cancel & refund"
        cancelLabel="Keep"
        input={{ label: "Cancellation reason", placeholder: "e.g. Out of stock / duplicate request" }}
        onConfirm={async (reason) => {
          if (!reason || reason.trim().length < 3) { toast.error("Enter a cancellation reason."); return; }
          const ok = await act({ action: "cancel", bookingId: cancelTarget!.id, reason: reason.trim() });
          if (ok) { toast.success("Booking cancelled & refunded."); setCancelTarget(null); }
        }}
      />
    </div>
  );
}

/* ── CSV export ── */
function downloadBookingsCsv(rows: Booking[], filename: string) {
  const headers = [
    "Order ID", "Applicant", "Role", "Shop", "User Code", "Phone", "Email",
    "Plan", "Status", "Amount Paid", "Monthly Rent", "GST", "Deposit", "Setup Fee",
    "Billing Day", "Machine TID", "Machine Serial", "Courier", "Tracking",
    "Delivery Address", "Contact Name", "Contact Phone", "Booked At",
  ];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((b) =>
    [
      b.id.slice(-8).toUpperCase(), b.user.name, b.user.role, b.user.shopName ?? "",
      b.user.userCode ?? "", b.user.phone, b.user.email,
      b.plan.name, b.statusLabel, b.amountPaid, b.monthlyRent, b.includeGst ? "Yes" : "No",
      b.deposit, b.setupFee, b.billingDay,
      b.machine?.tid ?? "", b.machine?.serial ?? "", b.courier ?? "", b.trackingRef ?? "",
      b.deliveryAddress, b.contactName ?? "", b.contactPhone ?? "",
      new Date(b.createdAt).toLocaleString("en-IN"),
    ].map(esc).join(","),
  );
  const csv = [headers.join(","), ...lines].join("\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function Info({ icon: Icon, label, children }: { icon: typeof Clock; label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-ink-50 px-4 py-3">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
        <Icon className="h-3.5 w-3.5" /> {label}
      </p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/* ── Assign modal (machine picker) ── */
function AssignModal({
  booking, machines, busy, onClose, onAssign,
}: {
  booking: Booking | null;
  machines: MachineOption[];
  busy: boolean;
  onClose: () => void;
  onAssign: (machineId: string) => void;
}) {
  const [q, setQ] = useState("");
  const [machineId, setMachineId] = useState("");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return machines;
    return machines.filter((m) =>
      [m.tid, m.serial, m.model, m.provider].filter(Boolean).some((v) => v!.toLowerCase().includes(term)),
    );
  }, [q, machines]);

  const inputCls =
    "w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100 placeholder:text-ink-400";

  return (
    <Modal
      open={booking !== null}
      onClose={() => { setQ(""); setMachineId(""); onClose(); }}
      eyebrow="Assign machine"
      title={booking ? `Allocate to ${booking.user.name}` : ""}
      subtitle={booking ? `${booking.plan.name} · deliver to: ${booking.deliveryAddress}` : ""}
      size="lg"
      footer={
        <>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => { setQ(""); setMachineId(""); onClose(); }}>Close</Button>
          <Button size="sm" disabled={busy || !machineId} onClick={() => onAssign(machineId)}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Assign & create subscription
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input className={`${inputCls} pl-9`} placeholder="Search by TID, serial, model…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>

        {machines.length === 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
            No unassigned machines in inventory. Add machines under POS Rental → Inventory Intake first.
          </div>
        ) : (
          <div className="max-h-72 overflow-y-auto rounded-xl border border-ink-100">
            {filtered.map((m) => (
              <label key={m.id}
                className={`flex cursor-pointer items-center gap-3 border-b border-ink-50 px-4 py-2.5 text-sm transition last:border-0 ${
                  machineId === m.id ? "bg-brand-50" : "hover:bg-ink-50"
                }`}>
                <input type="radio" name="machine" checked={machineId === m.id} onChange={() => setMachineId(m.id)}
                  className="h-4 w-4 border-ink-300 text-brand-600 focus:ring-brand-400" />
                <div className="min-w-0 flex-1">
                  <span className="font-mono text-xs font-semibold text-ink-900">{m.tid ? `TID: ${m.tid}` : m.serial ?? m.id.slice(0, 8)}</span>
                  {m.model && <span className="ml-2 text-xs text-ink-400">{m.model}</span>}
                </div>
                <Badge variant="default">{m.provider}</Badge>
              </label>
            ))}
            {filtered.length === 0 && <p className="px-4 py-6 text-center text-sm text-ink-400">No machines match “{q}”.</p>}
          </div>
        )}
        <p className="text-[11px] text-ink-400">
          The first month&apos;s rent was pre-paid at booking. Assigning creates the monthly rental subscription; billing resumes next cycle.
        </p>
      </div>
    </Modal>
  );
}

/* ── Dispatch modal ── */
function DispatchModal({
  booking, busy, onClose, onDispatch,
}: {
  booking: Booking | null;
  busy: boolean;
  onClose: () => void;
  onDispatch: (courier: string | undefined, trackingRef: string | undefined) => void;
}) {
  const [courier, setCourier] = useState("");
  const [trackingRef, setTrackingRef] = useState("");

  const inputCls =
    "w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100 placeholder:text-ink-400";

  return (
    <Modal
      open={booking !== null}
      onClose={() => { setCourier(""); setTrackingRef(""); onClose(); }}
      eyebrow="Dispatch"
      title={booking ? `Dispatch to ${booking.user.name}` : ""}
      subtitle={booking?.machine ? `Machine ${booking.machine.tid ?? booking.machine.serial ?? ""}` : ""}
      size="md"
      footer={
        <>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => { setCourier(""); setTrackingRef(""); onClose(); }}>Close</Button>
          <Button size="sm" disabled={busy} onClick={() => onDispatch(courier.trim() || undefined, trackingRef.trim() || undefined)}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
            Confirm dispatch
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-ink-700">Courier / carrier (optional)</label>
          <input className={inputCls} placeholder="e.g. Delhivery, BlueDart, hand delivery" value={courier} onChange={(e) => setCourier(e.target.value)} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-ink-700">Tracking reference (optional)</label>
          <input className={inputCls} placeholder="AWB / tracking number" value={trackingRef} onChange={(e) => setTrackingRef(e.target.value)} />
        </div>
        <p className="text-[11px] text-ink-400">The applicant is notified in real time and sees the tracking details on their booking.</p>
      </div>
    </Modal>
  );
}
