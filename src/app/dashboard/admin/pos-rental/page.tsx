"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { formatINR, formatNumber } from "@/lib/utils";
import {
  RefreshCw, ReceiptText, Plus, Upload, History, Search, IndianRupee,
  CreditCard, AlertCircle, CheckCircle2, XCircle, Loader2, Percent, Pencil, Clock, Gift,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

type Plan = {
  id: string;
  name: string;
  description: string | null;
  monthlyRent: number;
  setupFee: number;
  deposit: number;
  includeGst: boolean;
  active: boolean;
  activeSubscriptions: number;
};

type Sub = {
  id: string;
  status: string;
  billingDay: number;
  monthlyRent: number | null;
  includeGst: boolean;
  commission: number;
  effectiveRent: number;
  startedAt: string;
  cancelledAt: string | null;
  plan: { name: string; monthlyRent: number };
  user: { id: string; name: string; email: string };
  machine: { id: string; serial: string | null; tid: string | null; model: string | null };
};

type Invoice = {
  id: string;
  periodKey: string;
  amount: number;
  gstAmount: number;
  totalAmount: number;
  commissionAmount: number;
  status: string;
  detail: string | null;
  createdAt: string;
  user: { name: string; email: string };
  machine: { serial: string | null; tid: string | null };
  plan: string;
};

type Overview = {
  config: { enabled: boolean; hour: number };
  waiver: { enabled: boolean; thresholdPerMachine: number };
  summary: {
    periodKey: string;
    activeSubscriptions: number;
    paidCount: number;
    paidAmount: number;
    paidGst: number;
    paidCommission: number;
    failedCount: number;
    failedAmount: number;
    waivedCount: number;
  };
  plans: Plan[];
  subscriptions: Sub[];
  subTotal: number;
  page: number;
  pageSize: number;
  invoices: Invoice[];
};

type Tab = "plans" | "subscriptions" | "invoices" | "intake";

const inputCls =
  "w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100 placeholder:text-ink-400";

const labelCls = "mb-1.5 block text-xs font-semibold text-ink-500";

function Stat({ label, value, icon: Icon, tone }: { label: string; value: string; icon: React.ElementType; tone?: "good" | "bad" | "brand" }) {
  const colors = {
    good: "text-emerald-600 bg-emerald-50",
    bad: "text-rose-600 bg-rose-50",
    brand: "text-brand-600 bg-brand-50",
  };
  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-4">
      <div className="flex items-center gap-2">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${tone ? colors[tone] : "bg-ink-50 text-ink-500"}`}>
          <Icon className="h-4 w-4" />
        </div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">{label}</p>
      </div>
      <p className={`mt-2 text-xl font-bold ${
        tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-rose-600" : tone === "brand" ? "text-brand-600" : "text-ink-900"
      }`}>
        {value}
      </p>
    </div>
  );
}

export default function PosRentalPage() {
  const [tab, setTab] = useState<Tab>("plans");
  const [data, setData] = useState<Overview | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [runBillingOpen, setRunBillingOpen] = useState(false);
  const notify = useCallback((text: string, ok: boolean) => {
    if (ok) toast.success(text);
    else toast.error(text);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/pos/rental?page=${page}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "Failed to load rental console");
      setData(d);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Load failed", false);
    } finally {
      setLoading(false);
    }
  }, [page, notify]);

  useEffect(() => { load(); }, [load]);

  const act = async (body: Record<string, unknown>, doneMsg?: string) => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/pos/rental", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(typeof d?.error === "string" ? d.error : "Action failed");
      if (body.action === "run_billing" && d.result) {
        notify(
          `Billing complete: ${d.result.billed} billed, ${d.result.waived ?? 0} waived, ${d.result.failed} failed, ${d.result.skipped} skipped.`,
          d.result.failed === 0
        );
      } else {
        notify(doneMsg ?? "Done.", true);
      }
      load();
      return true;
    } catch (e) {
      notify(e instanceof Error ? e.message : "Action failed", false);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const s = data?.summary;

  const tabs: Array<{ key: Tab; label: string; icon: React.ElementType }> = [
    { key: "plans", label: "Rental Plans", icon: CreditCard },
    { key: "subscriptions", label: "Subscriptions", icon: ReceiptText },
    { key: "invoices", label: `Invoices (${data?.summary.periodKey ?? ""})`, icon: IndianRupee },
    { key: "intake", label: "Inventory Intake", icon: Upload },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="POS Rental & Billing"
        description="Create rental plans, assign machine subscriptions with GST & commission, track monthly invoices, and manage inventory."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-xl border border-ink-200 bg-white px-2.5 py-1.5">
              <Clock className="h-3.5 w-3.5 text-ink-400" />
              <span className="text-xs font-medium text-ink-500">Billing at</span>
              <select
                className="rounded-lg border border-ink-200 bg-ink-50 px-2 py-1 text-xs font-semibold text-ink-800 outline-none transition focus:border-brand-400 focus:ring-1 focus:ring-brand-100"
                value={data?.config.hour ?? 3}
                disabled={busy}
                onChange={(e) =>
                  act(
                    { action: "set_billing_hour", hour: Number(e.target.value) },
                    `Billing time set to ${String(e.target.value).padStart(2, "0")}:00 IST.`
                  )
                }
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00 IST
                  </option>
                ))}
              </select>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                act(
                  { action: "toggle_billing", enabled: !(data?.config.enabled ?? false) },
                  data?.config.enabled ? "Auto-billing disabled." : "Auto-billing enabled."
                )
              }
            >
              {data?.config.enabled ? "Disable auto-billing" : "Enable auto-billing"}
            </Button>
            <Button size="sm" disabled={busy} onClick={() => setRunBillingOpen(true)}>
              <ReceiptText className="h-4 w-4" /> Run billing now
            </Button>
            <Button variant="outline" size="sm" onClick={load}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      {s && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-7">
          <Stat
            label={`Cycle ${s.periodKey}`}
            value={data?.config.enabled ? "AUTO ON" : "AUTO OFF"}
            icon={RefreshCw}
            tone={data?.config.enabled ? "good" : "bad"}
          />
          <Stat label="Active Subs" value={formatNumber(s.activeSubscriptions)} icon={CreditCard} tone="brand" />
          <Stat label="Rent Collected" value={formatINR(s.paidAmount)} icon={IndianRupee} tone="good" />
          <Stat label="GST Collected" value={formatINR(s.paidGst ?? 0)} icon={Percent} tone="good" />
          <Stat label="Commission Paid" value={formatINR(s.paidCommission ?? 0)} icon={IndianRupee} />
          <Stat label="Failed Invoices" value={String(s.failedCount)} icon={XCircle} tone={s.failedCount > 0 ? "bad" : undefined} />
          <Stat label="Failed Amount" value={formatINR(s.failedAmount)} icon={AlertCircle} tone={s.failedAmount > 0 ? "bad" : undefined} />
        </div>
      )}

      <WaiverCard waiver={data?.waiver} busy={busy} act={act} />

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-ink-100 bg-ink-50/60 p-1">
        {tabs.map(({ key, label, icon: TabIcon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all ${
              tab === key
                ? "bg-white text-ink-900 shadow-sm ring-1 ring-ink-100"
                : "text-ink-500 hover:text-ink-700"
            }`}
          >
            <TabIcon className="h-4 w-4" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {tab === "plans" && <PlansTab plans={data?.plans ?? []} loading={loading} busy={busy} act={act} />}
      {tab === "subscriptions" && (
        <SubscriptionsTab
          subs={data?.subscriptions ?? []}
          total={data?.subTotal ?? 0}
          page={page}
          pageSize={data?.pageSize ?? 25}
          setPage={setPage}
          loading={loading}
          busy={busy}
          act={act}
          plans={(data?.plans ?? []).filter((p) => p.active)}
        />
      )}
      {tab === "invoices" && <InvoicesTab invoices={data?.invoices ?? []} loading={loading} busy={busy} act={act} />}
      {tab === "intake" && <IntakeTab onNotice={notify} />}

      <ConfirmDialog
        open={runBillingOpen}
        onClose={() => setRunBillingOpen(false)}
        busy={busy}
        tone="default"
        title="Run rental billing now?"
        description="All due subscriptions will be billed immediately for the current cycle."
        confirmLabel="Run now"
        onConfirm={async () => {
          await act({ action: "run_billing" });
          setRunBillingOpen(false);
        }}
      />
    </div>
  );
}

/* ───────────────────────────────────────────────── Free-rent waiver */

function WaiverCard({
  waiver, busy, act,
}: {
  waiver?: { enabled: boolean; thresholdPerMachine: number };
  busy: boolean;
  act: (b: Record<string, unknown>, m?: string) => Promise<boolean>;
}) {
  const [threshold, setThreshold] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (waiver && !editing) setThreshold(String(waiver.thresholdPerMachine));
  }, [waiver, editing]);

  if (!waiver) return null;

  const enabled = waiver.enabled;
  const parsed = Number(threshold);
  const dirty = editing && parsed > 0 && parsed !== waiver.thresholdPerMachine;

  return (
    <div className={`rounded-2xl border p-5 transition-colors ${enabled ? "border-emerald-200 bg-emerald-50/40" : "border-ink-100 bg-white"}`}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${enabled ? "bg-emerald-100 text-emerald-600" : "bg-ink-100 text-ink-500"}`}>
            <Gift className="h-5 w-5" />
          </div>
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-900">
              Free-rent on business target
              <Badge variant={enabled ? "success" : "default"}>{enabled ? "ON" : "OFF"}</Badge>
            </h3>
            <p className="mt-0.5 max-w-xl text-xs text-ink-500">
              When a machine does at least the target POS business in its billing cycle, that
              machine&apos;s rent is auto-waived — no debit and no commission that cycle. Checked per machine.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className={labelCls}>Target per machine (₹)</label>
            <div className="flex items-center gap-2">
              <input
                className={`${inputCls} w-40`}
                type="number"
                min="1"
                step="1"
                value={threshold}
                onFocus={() => setEditing(true)}
                onChange={(e) => setThreshold(e.target.value)}
              />
              <Button
                size="sm"
                disabled={busy || !dirty}
                onClick={async () => {
                  const ok = await act(
                    { action: "set_waiver_threshold", amount: parsed },
                    `Target set to ${formatINR(parsed)} per machine.`
                  );
                  if (ok) setEditing(false);
                }}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Save
              </Button>
            </div>
            <p className="mt-1 text-[11px] text-ink-400">
              Current: {formatINR(waiver.thresholdPerMachine)} · e.g. {formatINR(waiver.thresholdPerMachine * 3)} of business frees 3 machines.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              act(
                { action: "toggle_waiver", enabled: !enabled },
                enabled ? "Free-rent waiver disabled." : "Free-rent waiver enabled."
              )
            }
          >
            {enabled ? "Disable" : "Enable"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── Rental Plans */

function PlansTab({
  plans, loading, busy, act,
}: {
  plans: Plan[];
  loading: boolean;
  busy: boolean;
  act: (b: Record<string, unknown>, m?: string) => Promise<boolean>;
}) {
  const [form, setForm] = useState({ name: "", description: "", monthlyRent: "", setupFee: "", deposit: "", includeGst: false });
  const [editPlan, setEditPlan] = useState<Plan | null>(null);
  const [editForm, setEditForm] = useState({ name: "", description: "", monthlyRent: "", setupFee: "", deposit: "", includeGst: false });

  const columns: Column<Plan>[] = [
    {
      key: "name",
      header: "Plan",
      render: (p) => (
        <div>
          <p className="font-semibold text-ink-900">{p.name}</p>
          {p.description && <p className="mt-0.5 text-xs text-ink-400">{p.description}</p>}
        </div>
      ),
    },
    { key: "rent", header: "Monthly Rent", render: (p) => <span className="font-semibold text-ink-900">{formatINR(p.monthlyRent)}</span> },
    { key: "setup", header: "Setup Fee", render: (p) => <span className="text-ink-600">{formatINR(p.setupFee)}</span> },
    { key: "deposit", header: "Deposit", render: (p) => <span className="text-ink-600">{formatINR(p.deposit)}</span> },
    { key: "gst", header: "GST", render: (p) => <Badge variant={p.includeGst ? "success" : "default"}>{p.includeGst ? "18% GST" : "No GST"}</Badge> },
    { key: "subs", header: "Active Subs", render: (p) => <Badge variant="brand">{p.activeSubscriptions}</Badge> },
    {
      key: "active",
      header: "Status",
      render: (p) => <Badge variant={p.active ? "success" : "danger"}>{p.active ? "Active" : "Inactive"}</Badge>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (p) => (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={busy}
            onClick={() => {
              setEditPlan(p);
              setEditForm({
                name: p.name,
                description: p.description ?? "",
                monthlyRent: String(p.monthlyRent),
                setupFee: String(p.setupFee),
                deposit: String(p.deposit),
                includeGst: p.includeGst,
              });
            }}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
          <Button size="sm" variant="outline" disabled={busy}
            onClick={() => act({ action: "toggle_plan", planId: p.id, active: !p.active }, "Plan updated.")}>
            {p.active ? "Deactivate" : "Activate"}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-ink-100 bg-white p-6">
        <div className="mb-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-900">
            <Plus className="h-4 w-4 text-brand-600" /> Create New Rental Plan
          </h3>
          <p className="mt-1 text-xs text-ink-400">
            Define a reusable plan with monthly rent, one-time setup fee, and refundable deposit.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className={labelCls}>Plan Name *</label>
            <input className={inputCls} placeholder="e.g. Standard POS" value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label className={labelCls}>Description</label>
            <input className={inputCls} placeholder="Optional description" value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <div>
            <label className={labelCls}>Monthly Rent (₹) *</label>
            <input className={inputCls} type="number" min="0" step="0.01" placeholder="500" value={form.monthlyRent}
              onChange={(e) => setForm((f) => ({ ...f, monthlyRent: e.target.value }))} />
          </div>
          <div>
            <label className={labelCls}>Setup Fee (₹)</label>
            <input className={inputCls} type="number" min="0" step="0.01" placeholder="0" value={form.setupFee}
              onChange={(e) => setForm((f) => ({ ...f, setupFee: e.target.value }))} />
          </div>
          <div>
            <label className={labelCls}>Deposit (₹)</label>
            <input className={inputCls} type="number" min="0" step="0.01" placeholder="0" value={form.deposit}
              onChange={(e) => setForm((f) => ({ ...f, deposit: e.target.value }))} />
          </div>
        </div>

        <div className="mt-4">
          <label className="flex w-fit cursor-pointer items-center gap-2 rounded-xl border border-ink-200 bg-ink-50/60 px-3 py-2 text-sm">
            <input type="checkbox" checked={form.includeGst}
              onChange={(e) => setForm((f) => ({ ...f, includeGst: e.target.checked }))}
              className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-400" />
            <span className="font-medium text-ink-700">Charge 18% GST on this plan</span>
            <span className="text-xs text-ink-400">(applied to rent &amp; commission by default)</span>
          </label>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <Button size="sm" disabled={busy || form.name.trim().length < 2 || !form.monthlyRent}
            onClick={async () => {
              const ok = await act({
                action: "create_plan",
                name: form.name,
                description: form.description || undefined,
                monthlyRent: Number(form.monthlyRent),
                setupFee: Number(form.setupFee || 0),
                deposit: Number(form.deposit || 0),
                includeGst: form.includeGst,
              }, "Rental plan created.");
              if (ok) setForm({ name: "", description: "", monthlyRent: "", setupFee: "", deposit: "", includeGst: false });
            }}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Create Plan
          </Button>
          {form.monthlyRent && (
            <span className="text-xs text-ink-500">
              Plan preview: {formatINR(Number(form.monthlyRent))}/mo
              {form.includeGst ? " + 18% GST" : ""}
              {Number(form.setupFee) > 0 ? ` + ${formatINR(Number(form.setupFee))} setup` : ""}
              {Number(form.deposit) > 0 ? ` + ${formatINR(Number(form.deposit))} deposit` : ""}
            </span>
          )}
        </div>
      </div>

      <DataTable columns={columns} data={plans} loading={loading}
        title="All Rental Plans"
        description={`${plans.length} plan${plans.length === 1 ? "" : "s"} configured`} />

      {/* Edit Plan Modal */}
      <Modal
        open={!!editPlan}
        onClose={() => setEditPlan(null)}
        title="Edit Rental Plan"
        subtitle="Update the plan details. Changes apply to new invoices only."
        size="md"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setEditPlan(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={busy || editForm.name.trim().length < 2 || !editForm.monthlyRent}
              onClick={async () => {
                const ok = await act({
                  action: "update_plan",
                  planId: editPlan!.id,
                  name: editForm.name,
                  description: editForm.description || undefined,
                  monthlyRent: Number(editForm.monthlyRent),
                  setupFee: Number(editForm.setupFee || 0),
                  deposit: Number(editForm.deposit || 0),
                  includeGst: editForm.includeGst,
                }, "Plan updated successfully.");
                if (ok) setEditPlan(null);
              }}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Save Changes
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Plan Name *</label>
            <input className={inputCls} placeholder="e.g. Standard POS" value={editForm.name}
              onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label className={labelCls}>Description</label>
            <input className={inputCls} placeholder="Optional description" value={editForm.description}
              onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Monthly Rent (₹) *</label>
              <input className={inputCls} type="number" min="0" step="0.01" value={editForm.monthlyRent}
                onChange={(e) => setEditForm((f) => ({ ...f, monthlyRent: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Setup Fee (₹)</label>
              <input className={inputCls} type="number" min="0" step="0.01" value={editForm.setupFee}
                onChange={(e) => setEditForm((f) => ({ ...f, setupFee: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Deposit (₹)</label>
              <input className={inputCls} type="number" min="0" step="0.01" value={editForm.deposit}
                onChange={(e) => setEditForm((f) => ({ ...f, deposit: e.target.value }))} />
            </div>
          </div>
          <label className="flex w-fit cursor-pointer items-center gap-2 rounded-xl border border-ink-200 bg-ink-50/60 px-3 py-2 text-sm">
            <input type="checkbox" checked={editForm.includeGst}
              onChange={(e) => setEditForm((f) => ({ ...f, includeGst: e.target.checked }))}
              className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-400" />
            <span className="font-medium text-ink-700">Charge 18% GST on this plan</span>
          </label>
          {editForm.monthlyRent && (
            <div className="rounded-xl border border-ink-100 bg-ink-50 p-3">
              <p className="text-xs text-ink-500">
                Updated preview: <span className="font-semibold text-ink-900">{formatINR(Number(editForm.monthlyRent))}/mo</span>
                {editForm.includeGst ? " + 18% GST" : ""}
                {Number(editForm.setupFee) > 0 ? ` + ${formatINR(Number(editForm.setupFee))} setup` : ""}
                {Number(editForm.deposit) > 0 ? ` + ${formatINR(Number(editForm.deposit))} deposit` : ""}
              </p>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

/* ─────────────────────────────────────────────────────── Subscriptions */

type PickUser = { id: string; name: string; userCode: string; role: string; shop: string; city: string; walletBalance: number };
type SDMachine = { id: string; serial: string | null; tid: string | null; model: string | null; status: string; hasSub: boolean };

function SubscriptionsTab({
  subs, total, page, pageSize, setPage, loading, busy, act, plans,
}: {
  subs: Sub[];
  total: number;
  page: number;
  pageSize: number;
  setPage: (fn: (p: number) => number) => void;
  loading: boolean;
  busy: boolean;
  act: (b: Record<string, unknown>, m?: string) => Promise<boolean>;
  plans: Plan[];
}) {
  // User search + selection (any network user, not just super-distributors)
  const [userQuery, setUserQuery] = useState("");
  const [userResults, setUserResults] = useState<PickUser[]>([]);
  const [userSearching, setUserSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState<PickUser | null>(null);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [sdMachines, setSdMachines] = useState<SDMachine[]>([]);
  const [machLoading, setMachLoading] = useState(false);

  // Subscription config for batch
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [monthlyRent, setMonthlyRent] = useState(plans[0] ? String(plans[0].monthlyRent) : "");
  const [includeGst, setIncludeGst] = useState(plans[0]?.includeGst ?? false);
  const [billingDay, setBillingDay] = useState(1);
  const [selectedMachines, setSelectedMachines] = useState<Set<string>>(new Set());
  const [cancelTarget, setCancelTarget] = useState<Sub | null>(null);

  // Debounced user search — any user (retailer → super-distributor)
  useEffect(() => {
    const q = userQuery.trim();
    if (q.length < 2) { setUserResults([]); setUserSearching(false); return; }
    setUserSearching(true);
    const t = setTimeout(() => {
      fetch(`/api/admin/users?q=${encodeURIComponent(q)}&pageSize=25`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setUserResults((d?.users ?? []) as PickUser[]))
        .catch(() => setUserResults([]))
        .finally(() => setUserSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [userQuery]);

  // Fetch machines for the selected user (includes machines in their downline)
  useEffect(() => {
    if (!selectedUserId) { setSdMachines([]); return; }
    setMachLoading(true);
    setSelectedMachines(new Set());
    fetch(`/api/admin/pos/machines?assignee=${selectedUserId}&includeDownline=true&pageSize=200`)
      .then((r) => (r.ok ? r.json() : null))
      .then(async (d) => {
        const machines = (d?.data ?? []) as Array<{ id: string; serial: string | null; tid: string | null; model: string | null; status: string }>;
        // Check which machines already have an active subscription for this user
        const subRes = await fetch(`/api/admin/pos/rental`).then((r) => r.ok ? r.json() : null).catch(() => null);
        const userActiveSubs = new Set(
          ((subRes?.subscriptions ?? []) as Sub[])
            .filter((s) => s.status === "ACTIVE" && s.user.id === selectedUserId)
            .map((s) => s.machine.id)
        );
        setSdMachines(machines.map((m) => ({ ...m, hasSub: userActiveSubs.has(m.id) })));
      })
      .catch(() => {})
      .finally(() => setMachLoading(false));
  }, [selectedUserId]);

  const handlePlanChange = (id: string) => {
    setPlanId(id);
    const plan = plans.find((p) => p.id === id);
    if (plan) {
      setMonthlyRent(String(plan.monthlyRent));
      setIncludeGst(plan.includeGst);
    }
  };

  const baseRent = Number(monthlyRent || 0);
  const gst = includeGst ? Math.round(baseRent * 0.18 * 100) / 100 : 0;
  const totalPerMachine = baseRent + gst;
  const machinesWithoutSub = sdMachines.filter((m) => !m.hasSub);
  const canAssign = selectedMachines.size > 0 && planId && baseRent > 0;

  const toggleMachine = (id: string) => {
    setSelectedMachines((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllWithoutSub = () => {
    setSelectedMachines(new Set(machinesWithoutSub.map((m) => m.id)));
  };

  const assignSubscriptions = async () => {
    let success = 0;
    let fail = 0;
    for (const machineId of selectedMachines) {
      const ok = await act({
        action: "subscribe",
        machineId,
        userId: selectedUserId,
        planId,
        billingDay,
        monthlyRent: baseRent,
        commission: 0,
        includeGst,
        chargeSetup: false,
      });
      if (ok) success++;
      else fail++;
    }
    if (success > 0) {
      setSelectedMachines(new Set());
      // Refresh machines list
      setSelectedUserId((prev) => { setSelectedUserId(""); setTimeout(() => setSelectedUserId(prev), 100); return prev; });
    }
    if (fail > 0) {
      toast.warning(`${success} of ${success + fail} subscriptions created`, {
        description: `${fail} subscription(s) failed.`,
      });
    }
  };

  const activeSubs = subs.filter((s) => s.status === "ACTIVE");
  const totalActiveRent = activeSubs.reduce((sum, s) => sum + s.effectiveRent, 0);

  const columns: Column<Sub>[] = [
    {
      key: "machine",
      header: "Machine",
      render: (r) => (
        <div>
          <p className="font-mono text-xs font-semibold text-ink-900">{r.machine.tid ?? r.machine.serial ?? "—"}</p>
          <p className="text-[11px] text-ink-400">{r.machine.model ?? ""}</p>
        </div>
      ),
    },
    {
      key: "user",
      header: "Subscriber",
      render: (r) => (
        <div>
          <p className="text-sm font-medium text-ink-900">{r.user.name}</p>
          <p className="text-[11px] text-ink-400">{r.user.email}</p>
        </div>
      ),
    },
    {
      key: "plan",
      header: "Plan",
      render: (r) => <span className="text-sm text-ink-700">{r.plan.name}</span>,
    },
    {
      key: "rent",
      header: "Monthly Rent",
      align: "right",
      render: (r) => (
        <div className="text-right">
          <p className="font-semibold text-ink-900">{formatINR(r.effectiveRent)}</p>
          {r.includeGst && <p className="text-[11px] text-ink-400">+ 18% GST</p>}
        </div>
      ),
    },
    {
      key: "commission",
      header: "Commission",
      align: "right",
      render: (r) => (
        <span className={`font-medium ${r.commission > 0 ? "text-emerald-600" : "text-ink-400"}`}>
          {r.commission > 0 ? formatINR(r.commission) : "—"}
        </span>
      ),
    },
    {
      key: "billing",
      header: "Billing Day",
      render: (r) => <span className="text-xs text-ink-500">{r.billingDay}{r.billingDay === 1 ? "st" : r.billingDay === 2 ? "nd" : r.billingDay === 3 ? "rd" : "th"}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <Badge variant={r.status === "ACTIVE" ? "success" : r.status === "CANCELLED" ? "danger" : "warning"}>
          {r.status.toLowerCase()}
        </Badge>
      ),
    },
    {
      key: "since",
      header: "Since",
      render: (r) => <span className="text-xs text-ink-500">{new Date(r.startedAt).toLocaleDateString("en-IN")}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (r) =>
        r.status === "ACTIVE" ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setCancelTarget(r)}>
            Cancel
          </Button>
        ) : null,
    },
  ];

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      {/* Assign subscription panel */}
      <div className="rounded-2xl border border-ink-100 bg-white p-6">
        <div className="mb-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-900">
            <Plus className="h-4 w-4 text-brand-600" /> Assign Subscription
          </h3>
          <p className="mt-1 text-xs text-ink-400">
            Search any user, pick machines from their fleet, set a plan and rate — the rent auto-debits from their wallet every billing cycle.
          </p>
        </div>

        {/* Step 1: Select any user */}
        <div className="mb-4">
          <label className={labelCls}>Assign to user</label>
          {selectedUser ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2.5">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                  <span className="truncate">{selectedUser.name}</span>
                  <span className="shrink-0 rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase text-brand-700">{selectedUser.role}</span>
                </p>
                <p className="truncate text-xs text-ink-500">
                  {selectedUser.shop !== "—" ? selectedUser.shop : selectedUser.city} · {selectedUser.userCode} · Wallet {formatINR(selectedUser.walletBalance)}
                </p>
              </div>
              <button type="button"
                onClick={() => { setSelectedUser(null); setSelectedUserId(""); setUserQuery(""); setUserResults([]); }}
                className="shrink-0 text-xs font-semibold text-brand-600 hover:text-brand-800">
                Change
              </button>
            </div>
          ) : (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <input className={`${inputCls} pl-9`}
                placeholder="Search by name, shop, email, user code or city..."
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)} />
              {userQuery.trim().length >= 2 && (
                <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-ink-100 bg-white shadow-lg">
                  {userSearching ? (
                    <div className="flex items-center gap-2 px-4 py-3 text-sm text-ink-500">
                      <Loader2 className="h-4 w-4 animate-spin" /> Searching...
                    </div>
                  ) : userResults.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-ink-500">No users found.</div>
                  ) : (
                    userResults.map((u) => (
                      <button key={u.id} type="button"
                        onClick={() => { setSelectedUser(u); setSelectedUserId(u.id); setUserQuery(""); setUserResults([]); }}
                        className="flex w-full items-center justify-between gap-3 border-b border-ink-50 px-4 py-2.5 text-left transition-colors last:border-0 hover:bg-brand-50">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink-900">{u.name}</p>
                          <p className="truncate text-[11px] text-ink-400">
                            {u.shop !== "—" ? u.shop : u.city} · {u.userCode}
                          </p>
                        </div>
                        <span className="shrink-0 rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-ink-600">{u.role}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {selectedUserId && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
            {/* Left: Machines list */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className={labelCls}>Machines in this user&apos;s fleet</label>
                {machinesWithoutSub.length > 1 && (
                  <button onClick={selectAllWithoutSub}
                    className="text-xs font-semibold text-brand-600 hover:text-brand-800">
                    Select all without subscription ({machinesWithoutSub.length})
                  </button>
                )}
              </div>

              {machLoading ? (
                <div className="flex items-center gap-2 rounded-xl border border-ink-100 bg-ink-50 p-6 text-sm text-ink-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading machines...
                </div>
              ) : sdMachines.length === 0 ? (
                <div className="rounded-xl border border-ink-100 bg-ink-50 p-6 text-center text-sm text-ink-500">
                  No machines in this user&apos;s fleet. Go to <span className="font-semibold text-brand-700">POS Fleet</span> to assign machines first.
                </div>
              ) : (
                <div className="max-h-64 overflow-y-auto rounded-xl border border-ink-100">
                  {sdMachines.map((m) => (
                    <label key={m.id}
                      className={`flex cursor-pointer items-center gap-3 border-b border-ink-50 px-4 py-2.5 text-sm transition-colors last:border-0
                        ${m.hasSub ? "bg-emerald-50/30 opacity-60" : selectedMachines.has(m.id) ? "bg-brand-50" : "hover:bg-ink-50"}`}>
                      <input type="checkbox"
                        checked={selectedMachines.has(m.id)}
                        disabled={m.hasSub}
                        onChange={() => toggleMachine(m.id)}
                        className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-400" />
                      <div className="min-w-0 flex-1">
                        <span className="font-mono text-xs font-semibold text-ink-900">
                          {m.tid ? `TID: ${m.tid}` : m.serial ?? m.id.slice(0, 8)}
                        </span>
                        {m.model && <span className="ml-2 text-xs text-ink-400">{m.model}</span>}
                      </div>
                      {m.hasSub ? (
                        <Badge variant="success">subscribed</Badge>
                      ) : (
                        <Badge variant="default">no subscription</Badge>
                      )}
                    </label>
                  ))}
                </div>
              )}

              {selectedMachines.size > 0 && (
                <p className="mt-2 text-xs font-semibold text-brand-700">
                  {selectedMachines.size} machine{selectedMachines.size !== 1 ? "s" : ""} selected
                </p>
              )}
            </div>

            {/* Right: Plan + pricing */}
            <div className="space-y-3">
              <div>
                <label className={labelCls}>Rental Plan *</label>
                <select className={inputCls} value={planId} onChange={(e) => handlePlanChange(e.target.value)}>
                  {plans.length === 0 && <option value="">No plans — create one first</option>}
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} — {formatINR(p.monthlyRent)}/mo</option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelCls}>Monthly Rent per Machine (₹)</label>
                <input className={inputCls} type="number" min="0" step="0.01" value={monthlyRent}
                  onChange={(e) => setMonthlyRent(e.target.value)} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Billing Day</label>
                  <select className={inputCls} value={billingDay}
                    onChange={(e) => setBillingDay(Number(e.target.value))}>
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>{d}{d === 1 ? "st" : d === 2 ? "nd" : d === 3 ? "rd" : "th"}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end pb-0.5">
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" checked={includeGst}
                      onChange={(e) => setIncludeGst(e.target.checked)}
                      className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-400" />
                    <span className="text-ink-700">Include GST (18%)</span>
                  </label>
                </div>
              </div>

              {/* Live summary */}
              {baseRent > 0 && selectedMachines.size > 0 && (
                <div className="rounded-xl border border-ink-100 bg-ink-50 p-4">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Monthly Billing Summary</p>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex items-center justify-between text-xs text-ink-500">
                      <span>Per machine</span>
                      <span className="font-semibold text-ink-700">{formatINR(baseRent)}{includeGst ? ` + ${formatINR(gst)} GST` : ""}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-ink-600">{selectedMachines.size} machine{selectedMachines.size !== 1 ? "s" : ""} × {formatINR(totalPerMachine)}</span>
                      <span className="font-semibold text-ink-900">{formatINR(totalPerMachine * selectedMachines.size)}</span>
                    </div>
                    <div className="flex items-center justify-between border-t border-ink-200 pt-2">
                      <span className="font-semibold text-ink-800">Total Monthly</span>
                      <span className="text-base font-bold text-ink-900">{formatINR(totalPerMachine * selectedMachines.size)}</span>
                    </div>
                  </div>
                </div>
              )}

              <Button className="w-full" size="sm" disabled={busy || !canAssign} onClick={assignSubscriptions}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Create {selectedMachines.size} Subscription{selectedMachines.size !== 1 ? "s" : ""}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Active totals */}
      <div className="flex flex-wrap gap-4 rounded-2xl border border-ink-100 bg-white p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Active</p>
            <p className="text-sm font-bold text-ink-900">{activeSubs.length} subscription{activeSubs.length !== 1 ? "s" : ""}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <IndianRupee className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Monthly Revenue</p>
            <p className="text-sm font-bold text-ink-900">{formatINR(totalActiveRent)}</p>
          </div>
        </div>
      </div>

      <DataTable columns={columns} data={subs} loading={loading}
        title="All Subscriptions"
        description={`${formatNumber(total)} subscription${total === 1 ? "" : "s"} total`} />

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-ink-500">
          <span>Page {page} of {pages}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        busy={busy}
        title="Cancel this rental subscription?"
        description={
          cancelTarget && (
            <>
              <span className="font-semibold text-ink-900">{cancelTarget.user.name}</span> will no longer be billed{" "}
              <span className="font-semibold text-ink-900">{formatINR(cancelTarget.effectiveRent)}</span>/mo for machine{" "}
              <span className="font-mono font-semibold text-ink-900">
                {cancelTarget.machine.tid ?? cancelTarget.machine.serial ?? "—"}
              </span>
              .
            </>
          )
        }
        confirmLabel="Cancel subscription"
        cancelLabel="Keep it"
        onConfirm={async () => {
          if (!cancelTarget) return;
          await act({ action: "cancel_subscription", subscriptionId: cancelTarget.id }, "Subscription cancelled.");
          setCancelTarget(null);
        }}
      />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── Invoices */

function InvoicesTab({
  invoices, loading, busy, act,
}: {
  invoices: Invoice[];
  loading: boolean;
  busy: boolean;
  act: (b: Record<string, unknown>, m?: string) => Promise<boolean>;
}) {
  const [waiveTarget, setWaiveTarget] = useState<Invoice | null>(null);

  const columns: Column<Invoice>[] = [
    {
      key: "user",
      header: "User",
      render: (r) => (
        <div>
          <p className="text-sm font-medium text-ink-900">{r.user.name}</p>
          <p className="text-[11px] text-ink-400">{r.user.email}</p>
        </div>
      ),
    },
    {
      key: "machine",
      header: "Machine / Plan",
      render: (r) => (
        <div>
          <p className="font-mono text-xs font-semibold">{r.machine.tid ?? r.machine.serial ?? "—"}</p>
          <p className="text-[11px] text-ink-400">{r.plan}</p>
        </div>
      ),
    },
    { key: "period", header: "Period", render: (r) => <span className="text-sm">{r.periodKey}</span> },
    {
      key: "amount",
      header: "Rent",
      align: "right",
      render: (r) => <span className="font-medium text-ink-700">{formatINR(r.amount)}</span>,
    },
    {
      key: "gst",
      header: "GST",
      align: "right",
      render: (r) => (
        <span className={r.gstAmount > 0 ? "font-medium text-ink-700" : "text-ink-400"}>
          {r.gstAmount > 0 ? formatINR(r.gstAmount) : "—"}
        </span>
      ),
    },
    {
      key: "total",
      header: "Total Debited",
      align: "right",
      render: (r) => <span className="font-bold text-ink-900">{formatINR(r.totalAmount)}</span>,
    },
    {
      key: "commission",
      header: "Commission",
      align: "right",
      render: (r) => (
        <span className={r.commissionAmount > 0 ? "font-medium text-emerald-600" : "text-ink-400"}>
          {r.commissionAmount > 0 ? formatINR(r.commissionAmount) : "—"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <div>
          <Badge variant={r.status === "PAID" ? "success" : r.status === "FAILED" ? "danger" : "warning"}>
            {r.status.toLowerCase()}
          </Badge>
          {r.detail && <p className="mt-0.5 max-w-[140px] truncate text-[11px] text-ink-400" title={r.detail}>{r.detail}</p>}
        </div>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (r) =>
        r.status === "FAILED" ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setWaiveTarget(r)}>
            Waive
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <DataTable columns={columns} data={invoices} loading={loading}
        title="Monthly Invoices"
        description="Current billing period — shows rent, GST, total debited, and commission paid." />

      <ConfirmDialog
        open={waiveTarget !== null}
        onClose={() => setWaiveTarget(null)}
        busy={busy}
        tone="default"
        title="Waive this invoice?"
        description={
          waiveTarget && (
            <>
              The failed invoice of{" "}
              <span className="font-semibold text-ink-900">{formatINR(waiveTarget.totalAmount)}</span> for{" "}
              <span className="font-semibold text-ink-900">{waiveTarget.user.name}</span> ({waiveTarget.periodKey})
              will be marked as waived and won&apos;t be retried.
            </>
          )
        }
        confirmLabel="Waive"
        input={{ label: "Waiver note (optional)", placeholder: "Reason for waiving..." }}
        onConfirm={async (note) => {
          if (!waiveTarget) return;
          await act({ action: "waive_invoice", invoiceId: waiveTarget.id, note: note || undefined }, "Invoice waived.");
          setWaiveTarget(null);
        }}
      />
    </>
  );
}

/* ─────────────────────────────────────────────────────── Inventory Intake */

const CSV_COLUMNS = ["serial", "tid", "mid", "model", "brand", "company", "condition", "status", "location", "city", "state"];

type MachineRow = {
  serial: string; tid: string; mid: string; model: string; brand: string;
  company: string; condition: string; status: string; location: string;
  city: string; state: string;
};

const emptyRow = (): MachineRow => ({
  serial: "", tid: "", mid: "", model: "", brand: "", company: "",
  condition: "NEW", status: "active", location: "", city: "", state: "",
});

type IntakeMode = "table" | "csv";

function IntakeTab({ onNotice }: { onNotice: (text: string, ok: boolean) => void }) {
  const [mode, setMode] = useState<IntakeMode>("table");
  const [rows, setRows] = useState<MachineRow[]>([emptyRow()]);
  const [csvText, setCsvText] = useState("");
  const [busy, setBusy] = useState(false);

  // Shared defaults applied to every new row
  const [defaults, setDefaults] = useState({ brand: "", company: "", condition: "NEW", status: "active", city: "", state: "" });

  const [trackQuery, setTrackQuery] = useState("");
  const [track, setTrack] = useState<{
    machine: Record<string, unknown> & { assignedUser: { name: string; email: string } | null };
    timeline: Array<{ id: string; action: string; from: string | null; to: string | null; by: string | null; note: string | null; at: string }>;
    subscriptions: Array<{ id: string; status: string; plan: { name: string; monthlyRent: number }; user: { name: string } }>;
  } | null>(null);

  const post = async (machines: Array<Record<string, string>>) => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/pos/machines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ machines }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(typeof d?.error === "string" ? d.error : "Intake failed");
      const errText = d.errors?.length ? ` ${d.errors.length} row(s) skipped (duplicate serials).` : "";
      onNotice(`${d.created} machine(s) added to inventory.${errText}`, true);
      return true;
    } catch (e) {
      onNotice(e instanceof Error ? e.message : "Intake failed", false);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const updateRow = (idx: number, field: keyof MachineRow, value: string) => {
    setRows((prev) => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };

  const addRows = (count: number) => {
    setRows((prev) => [
      ...prev,
      ...Array.from({ length: count }, () => ({
        ...emptyRow(),
        brand: defaults.brand,
        company: defaults.company,
        condition: defaults.condition,
        status: defaults.status,
        city: defaults.city,
        state: defaults.state,
      })),
    ]);
  };

  const removeRow = (idx: number) => {
    setRows((prev) => prev.length <= 1 ? [emptyRow()] : prev.filter((_, i) => i !== idx));
  };

  const validRows = rows.filter((r) => r.serial.trim().length >= 3);

  const submitRows = async () => {
    if (validRows.length === 0) {
      onNotice("No valid rows. Each row needs a serial number (3+ chars).", false);
      return;
    }
    const data = validRows.map((r) => {
      const row: Record<string, string> = {};
      Object.entries(r).forEach(([k, v]) => { if (v) row[k] = v; });
      return row;
    });
    const ok = await post(data);
    if (ok) setRows([emptyRow()]);
  };

  const parseCsv = (): Array<Record<string, string>> | null => {
    const lines = csvText.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) {
      onNotice("CSV needs a header row and at least one data row.", false);
      return null;
    }
    const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
    if (!header.includes("serial")) {
      onNotice('CSV header must include a "serial" column.', false);
      return null;
    }
    return lines.slice(1).map((line) => {
      const cells = line.split(",").map((c) => c.trim());
      const row: Record<string, string> = {};
      header.forEach((h, i) => { if (CSV_COLUMNS.includes(h) && cells[i]) row[h] = cells[i]; });
      if (row.condition) row.condition = row.condition.toUpperCase();
      if (row.status) row.status = row.status.toLowerCase();
      return row;
    });
  };

  const lookup = async () => {
    if (!trackQuery.trim()) return;
    setTrack(null);
    try {
      const res = await fetch(`/api/admin/pos/machines/${encodeURIComponent(trackQuery.trim())}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "Machine not found");
      setTrack(d);
    } catch (e) {
      onNotice(e instanceof Error ? e.message : "Lookup failed", false);
    }
  };

  const thinInput = "w-full rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-xs text-ink-900 outline-none transition focus:border-brand-400 focus:ring-1 focus:ring-brand-100 placeholder:text-ink-300";
  const thinSelect = `${thinInput} appearance-none`;

  return (
    <div className="space-y-4">
      {/* Mode toggle */}
      <div className="rounded-2xl border border-ink-100 bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-900">
              <Plus className="h-4 w-4 text-brand-600" /> Add Machines to Inventory
            </h3>
            <p className="mt-1 text-xs text-ink-400">
              Add 1 or 100+ machines at once. Use the table for manual entry or paste CSV for bulk.
            </p>
          </div>
          <div className="flex gap-1 rounded-lg border border-ink-200 bg-ink-50 p-0.5">
            <button
              onClick={() => setMode("table")}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${mode === "table" ? "bg-white text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-700"}`}
            >
              Table Entry
            </button>
            <button
              onClick={() => setMode("csv")}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${mode === "csv" ? "bg-white text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-700"}`}
            >
              Paste CSV
            </button>
          </div>
        </div>

        {mode === "table" ? (
          <>
            {/* Defaults bar */}
            <div className="mb-4 rounded-xl border border-dashed border-ink-200 bg-ink-50/50 p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                Defaults for new rows (auto-fill when you add rows)
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <div>
                  <label className="mb-0.5 block text-[10px] font-semibold text-ink-400">Brand</label>
                  <input className={thinInput} placeholder="Pax" value={defaults.brand}
                    onChange={(e) => setDefaults((d) => ({ ...d, brand: e.target.value }))} />
                </div>
                <div>
                  <label className="mb-0.5 block text-[10px] font-semibold text-ink-400">Company</label>
                  <input className={thinInput} placeholder="Bank" value={defaults.company}
                    onChange={(e) => setDefaults((d) => ({ ...d, company: e.target.value }))} />
                </div>
                <div>
                  <label className="mb-0.5 block text-[10px] font-semibold text-ink-400">Condition</label>
                  <select className={thinSelect} value={defaults.condition}
                    onChange={(e) => setDefaults((d) => ({ ...d, condition: e.target.value }))}>
                    <option value="NEW">New</option>
                    <option value="REFURBISHED">Refurbished</option>
                    <option value="DAMAGED">Damaged</option>
                  </select>
                </div>
                <div>
                  <label className="mb-0.5 block text-[10px] font-semibold text-ink-400">Status</label>
                  <select className={thinSelect} value={defaults.status}
                    onChange={(e) => setDefaults((d) => ({ ...d, status: e.target.value }))}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="maintenance">Maintenance</option>
                  </select>
                </div>
                <div>
                  <label className="mb-0.5 block text-[10px] font-semibold text-ink-400">City</label>
                  <input className={thinInput} placeholder="City" value={defaults.city}
                    onChange={(e) => setDefaults((d) => ({ ...d, city: e.target.value }))} />
                </div>
                <div>
                  <label className="mb-0.5 block text-[10px] font-semibold text-ink-400">State</label>
                  <input className={thinInput} placeholder="State" value={defaults.state}
                    onChange={(e) => setDefaults((d) => ({ ...d, state: e.target.value }))} />
                </div>
              </div>
            </div>

            {/* Spreadsheet-like table */}
            <div className="overflow-x-auto rounded-xl border border-ink-100">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-ink-100 bg-ink-50">
                    <th className="w-8 px-2 py-2 text-center text-[10px] font-bold text-ink-400">#</th>
                    <th className="min-w-[120px] px-1 py-2 text-left text-[10px] font-bold text-ink-500">SERIAL *</th>
                    <th className="min-w-[100px] px-1 py-2 text-left text-[10px] font-bold text-ink-500">TID</th>
                    <th className="min-w-[120px] px-1 py-2 text-left text-[10px] font-bold text-ink-500">MID</th>
                    <th className="min-w-[80px] px-1 py-2 text-left text-[10px] font-bold text-ink-500">MODEL</th>
                    <th className="min-w-[80px] px-1 py-2 text-left text-[10px] font-bold text-ink-500">BRAND</th>
                    <th className="min-w-[90px] px-1 py-2 text-left text-[10px] font-bold text-ink-500">COMPANY</th>
                    <th className="min-w-[80px] px-1 py-2 text-left text-[10px] font-bold text-ink-500">CONDITION</th>
                    <th className="min-w-[80px] px-1 py-2 text-left text-[10px] font-bold text-ink-500">LOCATION</th>
                    <th className="min-w-[70px] px-1 py-2 text-left text-[10px] font-bold text-ink-500">CITY</th>
                    <th className="min-w-[70px] px-1 py-2 text-left text-[10px] font-bold text-ink-500">STATE</th>
                    <th className="w-8 px-1 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr key={idx} className={`border-b border-ink-50 ${row.serial.trim().length >= 3 ? "" : row.serial.trim() ? "bg-rose-50/30" : ""}`}>
                      <td className="px-2 py-1 text-center text-[10px] font-semibold text-ink-300">{idx + 1}</td>
                      <td className="px-1 py-1">
                        <input className={`${thinInput} ${!row.serial.trim() ? "border-ink-200" : row.serial.trim().length < 3 ? "border-rose-300 bg-rose-50" : "border-emerald-300 bg-emerald-50/30"}`}
                          placeholder="Serial *" value={row.serial} onChange={(e) => updateRow(idx, "serial", e.target.value)} />
                      </td>
                      <td className="px-1 py-1"><input className={thinInput} placeholder="TID" value={row.tid} onChange={(e) => updateRow(idx, "tid", e.target.value)} /></td>
                      <td className="px-1 py-1"><input className={thinInput} placeholder="MID" value={row.mid} onChange={(e) => updateRow(idx, "mid", e.target.value)} /></td>
                      <td className="px-1 py-1"><input className={thinInput} placeholder="Model" value={row.model} onChange={(e) => updateRow(idx, "model", e.target.value)} /></td>
                      <td className="px-1 py-1"><input className={thinInput} placeholder="Brand" value={row.brand} onChange={(e) => updateRow(idx, "brand", e.target.value)} /></td>
                      <td className="px-1 py-1"><input className={thinInput} placeholder="Company" value={row.company} onChange={(e) => updateRow(idx, "company", e.target.value)} /></td>
                      <td className="px-1 py-1">
                        <select className={thinSelect} value={row.condition} onChange={(e) => updateRow(idx, "condition", e.target.value)}>
                          <option value="NEW">New</option>
                          <option value="REFURBISHED">Refurb</option>
                          <option value="DAMAGED">Damaged</option>
                        </select>
                      </td>
                      <td className="px-1 py-1"><input className={thinInput} placeholder="Location" value={row.location} onChange={(e) => updateRow(idx, "location", e.target.value)} /></td>
                      <td className="px-1 py-1"><input className={thinInput} placeholder="City" value={row.city} onChange={(e) => updateRow(idx, "city", e.target.value)} /></td>
                      <td className="px-1 py-1"><input className={thinInput} placeholder="State" value={row.state} onChange={(e) => updateRow(idx, "state", e.target.value)} /></td>
                      <td className="px-1 py-1">
                        <button onClick={() => removeRow(idx)} className="rounded p-1 text-ink-300 hover:bg-rose-50 hover:text-rose-500" title="Remove row">
                          <XCircle className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Add rows toolbar */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-ink-500">Add rows:</span>
              {[1, 5, 10, 25, 50].map((n) => (
                <button key={n} onClick={() => addRows(n)}
                  className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-600 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700">
                  +{n}
                </button>
              ))}
              <div className="ml-auto flex items-center gap-3">
                <span className="text-xs text-ink-400">
                  {rows.length} row{rows.length === 1 ? "" : "s"} · {validRows.length} valid
                </span>
                <Button size="sm" disabled={busy || validRows.length === 0} onClick={submitRows}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Add {validRows.length} machine{validRows.length === 1 ? "" : "s"}
                </Button>
              </div>
            </div>
          </>
        ) : (
          /* CSV paste mode */
          <>
            <div className="mb-2 text-xs text-ink-400">
              Paste CSV with a header row. Required: <code className="rounded bg-ink-100 px-1 font-mono text-[11px]">serial</code>.
              Optional: {CSV_COLUMNS.filter((c) => c !== "serial").join(", ")}. Max 500 rows.
            </div>
            <textarea
              className={`${inputCls} h-48 font-mono text-xs`}
              placeholder={"serial,tid,mid,model,brand,company,condition,location,city,state\nSN001,TID001,,S900,Pax,ICICI,NEW,Eros Mall,New Delhi,Delhi\nSN002,TID002,,D210,Verifone,HDFC,NEW,Main Road,Mumbai,Maharashtra"}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
            />
            <div className="mt-3 flex items-center gap-3">
              <Button size="sm" disabled={busy || !csvText.trim()}
                onClick={async () => {
                  const parsed = parseCsv();
                  if (!parsed) return;
                  const ok = await post(parsed);
                  if (ok) setCsvText("");
                }}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Upload {csvText.trim() ? csvText.trim().split(/\r?\n/).length - 1 : 0} rows
              </Button>
              <span className="text-xs text-ink-400">
                {csvText.trim() ? `${csvText.trim().split(/\r?\n/).length - 1} data row(s) detected` : "Paste CSV above"}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Tracking */}
      <div className="rounded-2xl border border-ink-100 bg-white p-6">
        <div className="mb-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-900">
            <History className="h-4 w-4 text-brand-600" /> Machine Tracking & Timeline
          </h3>
          <p className="mt-1 text-xs text-ink-400">
            Look up a machine by serial, TID, or ID to see its assignment history and subscription details.
          </p>
        </div>
        <div className="flex gap-2">
          <div className="relative max-w-md flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input
              className={`${inputCls} pl-9`}
              placeholder="Search by serial, TID, or machine ID..."
              value={trackQuery}
              onChange={(e) => setTrackQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && lookup()}
            />
          </div>
          <Button variant="outline" onClick={lookup}>
            <Search className="h-4 w-4" /> Track
          </Button>
        </div>

        {track && (
          <div className="mt-4 space-y-4">
            <div className="rounded-xl bg-ink-50 p-4 text-sm">
              <p className="font-semibold text-ink-900">
                {String(track.machine.serial ?? "no-serial")} · {String(track.machine.model ?? track.machine.brand ?? "")}
              </p>
              <p className="mt-1 text-xs text-ink-500">
                TID {String(track.machine.tid ?? "—")} · MID {String(track.machine.mid ?? "—")} · {String(track.machine.source)} · {String(track.machine.condition ?? "—")} · {String(track.machine.status)}
              </p>
              <p className="mt-1 text-xs text-ink-500">
                Assigned to:{" "}
                {track.machine.assignedUser
                  ? `${track.machine.assignedUser.name} (${track.machine.assignedUser.email})`
                  : "Unassigned"}
              </p>
            </div>

            {track.subscriptions.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-500">Rental Subscriptions</p>
                <ul className="space-y-1.5">
                  {track.subscriptions.map((s) => (
                    <li key={s.id} className="flex items-center gap-2 text-sm">
                      <Badge variant={s.status === "ACTIVE" ? "success" : "default"}>{s.status.toLowerCase()}</Badge>
                      <span>{s.plan.name} — {formatINR(s.plan.monthlyRent)}/mo — {s.user.name}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-500">Assignment Timeline</p>
              {track.timeline.length === 0 ? (
                <p className="text-sm text-ink-400">No assignment events recorded.</p>
              ) : (
                <ol className="relative ml-3 space-y-3 border-l border-ink-200 pl-5">
                  {track.timeline.map((t) => (
                    <li key={t.id} className="relative">
                      <span className="absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full bg-brand-500" />
                      <p className="text-sm text-ink-800">
                        <span className="font-semibold">{t.action}</span>
                        {t.to && <> → {t.to}</>}
                        {t.from && !t.to && <> (from {t.from})</>}
                      </p>
                      <p className="text-xs text-ink-400">
                        by {t.by ?? "system"} · {new Date(t.at).toLocaleString("en-IN")}
                        {t.note ? ` · ${t.note}` : ""}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
