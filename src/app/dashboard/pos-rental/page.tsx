"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Panel, StatTile, TablePro } from "@/components/dashboard/ui";
import { Reveal } from "@/components/motion";
import { formatINR, formatNumber } from "@/lib/utils";
import { useAuth } from "@/lib/useAuth";
import {
  Plus, Loader2, IndianRupee,
  CheckCircle2, RefreshCw, Pencil, X, CreditCard,
  AlertCircle, Receipt, ChevronDown, ChevronUp,
} from "lucide-react";

const HIERARCHY: Record<string, { childLabel: string; childLabelPlural: string }> = {
  "super-distributor": { childLabel: "Master-Distributor", childLabelPlural: "Master-Distributors" },
  "master-distributor": { childLabel: "Distributor", childLabelPlural: "Distributors" },
  distributor: { childLabel: "Retailer", childLabelPlural: "Retailers" },
};

type Child = { id: string; name: string; shop: string; role: string; city: string; email?: string };
type Machine = { id: string; serial: string | null; tid: string | null; model: string | null; status: string; hasSub: boolean };
type Plan = { id: string; name: string; monthlyRent: number; includeGst?: boolean; active: boolean; isOwn?: boolean };
type Sub = {
  id: string; status: string; billingDay: number; monthlyRent: number | null; includeGst: boolean;
  commission: number; effectiveRent: number; startedAt: string;
  plan: { name: string; monthlyRent: number };
  user: { id: string; name: string; email: string };
  machine: { id: string; serial: string | null; tid: string | null; model: string | null };
};
type MySub = {
  id: string; status: string; billingDay: number; includeGst: boolean;
  startedAt: string; cancelledAt: string | null;
  plan: { name: string };
  machine: { id: string; serial: string | null; tid: string | null; model: string | null };
  rent: number; gstAmount: number; totalPerMonth: number;
  assignedBy: { name: string; role: string };
};
type MyInvoice = {
  id: string; periodKey: string; amount: number; gstAmount: number; totalAmount: number;
  status: "PAID" | "FAILED" | "WAIVED"; detail: string | null; createdAt: string;
  machine: { tid: string | null; serial: string | null };
  planName: string;
};
type MyDues = { amount: number; count: number };

const inputCls = "w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100 placeholder:text-ink-400";
const labelCls = "mb-1.5 block text-xs font-semibold text-ink-500";

export default function NetworkPosRentalPage() {
  const { session } = useAuth();
  const role = session?.role ?? "distributor";
  const meta = HIERARCHY[role] ?? HIERARCHY.distributor;

  const [children, setChildren] = useState<Child[]>([]);
  const [childLoading, setChildLoading] = useState(true);
  const [selectedChild, setSelectedChild] = useState("");

  const [machines, setMachines] = useState<Machine[]>([]);
  const [machLoading, setMachLoading] = useState(false);
  const [selectedMachines, setSelectedMachines] = useState<Set<string>>(new Set());

  const [plans, setPlans] = useState<Plan[]>([]);
  const [machineCosts, setMachineCosts] = useState<Record<string, number>>({});
  const [planId, setPlanId] = useState("");
  const [monthlyRent, setMonthlyRent] = useState("");
  const [includeGst, setIncludeGst] = useState(false);
  const [billingDay, setBillingDay] = useState(1);

  const [subs, setSubs] = useState<Sub[]>([]);
  const [subsLoading, setSubsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Sub | null>(null);

  // ── My own rental (what upstream/admin charges me) ──
  const [mySubs, setMySubs] = useState<MySub[]>([]);
  const [myInvoices, setMyInvoices] = useState<MyInvoice[]>([]);
  const [myDues, setMyDues] = useState<MyDues>({ amount: 0, count: 0 });
  const [showInvoices, setShowInvoices] = useState(false);

  // ── My Rental Plans management ──
  const [planForm, setPlanForm] = useState({ name: "", description: "", monthlyRent: "", includeGst: false });
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [planBusy, setPlanBusy] = useState(false);

  const notify = useCallback((text: string, ok: boolean) => {
    if (ok) toast.success(text);
    else toast.error(text);
  }, []);

  // Load children + plans + own subscriptions + machine costs
  useEffect(() => {
    Promise.all([
      fetch("/api/network?pageSize=100").then((r) => r.ok ? r.json() : null),
      fetch("/api/network/pos/rental").then((r) => r.ok ? r.json() : null).catch(() => null),
    ]).then(([networkData, rentalData]) => {
      setChildren(networkData?.users ?? []);
      const allPlans = (rentalData?.plans ?? []) as Plan[];
      setPlans(allPlans);
      setMachineCosts(rentalData?.machineCosts ?? {});
      const activePlans = allPlans.filter((p) => p.active);
      if (activePlans.length > 0) {
        setPlanId(activePlans[0].id);
        setMonthlyRent(String(activePlans[0].monthlyRent));
        setIncludeGst(activePlans[0].includeGst ?? false);
      }
      setSubs(rentalData?.subscriptions ?? []);
      setMySubs(rentalData?.mySubscriptions ?? []);
      setMyInvoices(rentalData?.myInvoices ?? []);
      setMyDues(rentalData?.myDues ?? { amount: 0, count: 0 });
      setSubsLoading(false);
    }).catch(() => {}).finally(() => setChildLoading(false));
  }, []);

  // Fetch machines for selected child
  useEffect(() => {
    if (!selectedChild) { setMachines([]); return; }
    setMachLoading(true);
    setSelectedMachines(new Set());

    // Scope to the selected child's subtree server-side: a machine can be
    // rented to this child even after it has flowed further down the chain
    // (e.g. MD → DT → RT), so it may currently be held by the child or any of
    // the child's own descendants.
    fetch(`/api/pos/my-machines?pageSize=200&forChild=${encodeURIComponent(selectedChild)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        const childMachines = (d?.data ?? []) as Array<{ id: string; serial: string | null; tid: string | null; model: string | null; status: string; assignedUserId: string | null }>;
        // A machine is "subscribed" for this child only if the caller already
        // created an active subscription for this machine + this child.
        const activeSubs = new Set(
          subs.filter((s) => s.status === "ACTIVE" && s.user.id === selectedChild).map((s) => s.machine.id),
        );
        setMachines(childMachines.map((m) => ({ ...m, hasSub: activeSubs.has(m.id) })));
      })
      .catch(() => {})
      .finally(() => setMachLoading(false));
  }, [selectedChild, subs]);

  const handlePlanChange = (id: string) => {
    setPlanId(id);
    const plan = plans.find((p) => p.id === id);
    if (plan) {
      setMonthlyRent(String(plan.monthlyRent));
      setIncludeGst(plan.includeGst ?? false);
    }
  };

  const baseRent = Number(monthlyRent || 0);
  const gst = includeGst ? Math.round(baseRent * 0.18 * 100) / 100 : 0;
  const totalPerMachine = baseRent + gst;

  // Auto-calculate commission per machine from the spread (downstream rent −
  // upstream cost). When GST applies, 18% GST is added on top of the commission
  // spread, and 2% TDS is deducted from the base spread (GST is a pass-through,
  // not income): net = spread + GST(spread) − TDS(spread).
  const firstSelectedId = [...selectedMachines][0];
  const upstreamCost = firstSelectedId ? (machineCosts[firstSelectedId] ?? 0) : 0;
  // Machines with no active upstream subscription: the full rent would become
  // this user's commission and the upstream tier collects nothing.
  const machinesWithoutUpstream = [...selectedMachines].filter((id) => !(machineCosts[id] > 0));
  const commissionAmt = Math.max(0, Math.round((baseRent - upstreamCost) * 100) / 100);
  const commissionGst = includeGst ? Math.round(commissionAmt * 0.18 * 100) / 100 : 0;
  const tdsAmt = Math.round(commissionAmt * 0.02 * 100) / 100;
  const netCommission = Math.round((commissionAmt + commissionGst - tdsAmt) * 100) / 100;

  const assignablePlans = plans.filter((p) => p.active);
  const machinesWithoutSub = machines.filter((m) => !m.hasSub);
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
    setBusy(true);
    let success = 0;
    let fail = 0;
    for (const machineId of selectedMachines) {
      try {
        const res = await fetch("/api/network/pos/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            machineId,
            childId: selectedChild,
            planId,
            billingDay,
            monthlyRent: baseRent,
            includeGst,
          }),
        });
        if (res.ok) success++;
        else fail++;
      } catch {
        fail++;
      }
    }
    setBusy(false);
    setSelectedMachines(new Set());
    if (success > 0) {
      notify(`${success} subscription${success > 1 ? "s" : ""} created.`, true);
      refreshSubs();
    }
    if (fail > 0) notify(`${fail} subscription${fail > 1 ? "s" : ""} failed.`, false);
  };

  const refreshSubs = useCallback(() => {
    setSubsLoading(true);
    fetch("/api/network/pos/rental")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        setSubs(d?.subscriptions ?? []);
        if (d?.machineCosts) setMachineCosts(d.machineCosts);
        if (d?.mySubscriptions) setMySubs(d.mySubscriptions);
        if (d?.myInvoices) setMyInvoices(d.myInvoices);
        if (d?.myDues) setMyDues(d.myDues);
      })
      .catch(() => {})
      .finally(() => setSubsLoading(false));
  }, []);

  const cancelSub = async (subId: string) => {
    setBusy(true);
    try {
      const res = await fetch("/api/network/pos/rental", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel_subscription", subscriptionId: subId }),
      });
      if (res.ok) {
        notify("Subscription cancelled.", true);
        refreshSubs();
      } else {
        const d = await res.json();
        notify(d.error ?? "Cancel failed", false);
      }
    } catch {
      notify("Cancel failed", false);
    } finally {
      setBusy(false);
    }
  };

  const reloadPlans = useCallback(() => {
    fetch("/api/network/pos/rental")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.plans) setPlans(d.plans as Plan[]);
        if (d?.machineCosts) setMachineCosts(d.machineCosts);
      })
      .catch(() => {});
  }, []);

  const resetPlanForm = () => {
    setEditingPlanId(null);
    setPlanForm({ name: "", description: "", monthlyRent: "", includeGst: false });
  };

  const startEditPlan = (p: Plan) => {
    setEditingPlanId(p.id);
    setPlanForm({
      name: p.name,
      description: "",
      monthlyRent: String(p.monthlyRent),
      includeGst: p.includeGst ?? false,
    });
  };

  const savePlan = async () => {
    const name = planForm.name.trim();
    const rent = Number(planForm.monthlyRent);
    if (name.length < 2) { notify("Plan name must be at least 2 characters.", false); return; }
    if (!(rent >= 0) || !planForm.monthlyRent) { notify("Enter a valid monthly rent.", false); return; }
    setPlanBusy(true);
    try {
      const res = await fetch("/api/network/pos/rental", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: editingPlanId ? "update_plan" : "create_plan",
          ...(editingPlanId ? { planId: editingPlanId } : {}),
          name,
          description: planForm.description.trim() || undefined,
          monthlyRent: rent,
          includeGst: planForm.includeGst,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { notify(typeof d?.error === "string" ? d.error : "Could not save plan", false); return; }
      notify(editingPlanId ? "Plan updated." : "Plan created.", true);
      resetPlanForm();
      reloadPlans();
    } catch {
      notify("Request failed", false);
    } finally {
      setPlanBusy(false);
    }
  };

  const togglePlan = async (p: Plan) => {
    setPlanBusy(true);
    try {
      const res = await fetch("/api/network/pos/rental", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle_plan", planId: p.id, active: !p.active }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { notify(typeof d?.error === "string" ? d.error : "Could not update plan", false); return; }
      notify(p.active ? "Plan deactivated." : "Plan activated.", true);
      reloadPlans();
    } catch {
      notify("Request failed", false);
    } finally {
      setPlanBusy(false);
    }
  };

  const ownPlans = plans.filter((p) => p.isOwn);

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
      header: "Rent/mo",
      align: "right",
      render: (r) => (
        <div className="text-right">
          <p className="font-semibold text-ink-900">{formatINR(r.effectiveRent)}</p>
          {r.includeGst && <p className="text-[11px] text-ink-400">+ GST</p>}
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

  return (
    <div className="min-w-0 space-y-6">
      <Reveal distance={14} duration={0.4}>
        <PageHeader
          eyebrow="POS Management"
          title="POS Rental & Subscriptions"
          description={`Create your own rental plans and assign subscriptions to your ${meta.childLabelPlural.toLowerCase()}. Set monthly rent, commission, and GST per machine.`}
        />
      </Reveal>

      {/* My Rental — what upstream/admin charges me */}
      {(mySubs.length > 0 || myDues.amount > 0) && (
        <Reveal distance={16} duration={0.45}>
        <Panel className="p-6">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-soft">
                <Receipt className="h-4 w-4" />
              </span>
              <div>
                <h3 className="font-display text-base font-semibold text-ink-900">My Rental — Charged to You</h3>
                <p className="mt-1 text-xs text-ink-500">
                  Subscriptions assigned to you by your upstream. Rent is auto-debited from your wallet every month on the billing day.
                </p>
              </div>
            </div>
            {myInvoices.length > 0 && (
              <button
                onClick={() => setShowInvoices((v) => !v)}
                className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-800"
              >
                Payment history {showInvoices ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>

          {/* Outstanding dues banner */}
          {myDues.amount > 0 && (
            <div className="mb-4 flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
              <AlertCircle className="h-5 w-5 shrink-0 text-rose-600" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-rose-800">
                  Payment due: {formatINR(myDues.amount)}
                </p>
                <p className="text-xs text-rose-600">
                  {myDues.count} invoice{myDues.count === 1 ? "" : "s"} could not be collected (insufficient wallet balance). Top up your wallet — billing retries automatically.
                </p>
              </div>
            </div>
          )}

          {/* My subscriptions */}
          {mySubs.length > 0 && (
            <TablePro dense>
              <table>
                <thead>
                  <tr>
                    <th>Machine</th>
                    <th>Plan</th>
                    <th>Assigned By</th>
                    <th className="text-right">Rent/mo</th>
                    <th className="text-center">Billing Day</th>
                    <th className="text-center">Status</th>
                    <th>Since</th>
                  </tr>
                </thead>
                <tbody>
                  {mySubs.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <p className="font-mono text-xs font-semibold text-ink-900">{s.machine.tid ?? s.machine.serial ?? "—"}</p>
                        <p className="text-[11px] text-ink-400">{s.machine.model ?? ""}</p>
                      </td>
                      <td className="text-ink-700">{s.plan.name}</td>
                      <td>
                        <p className="text-xs font-medium text-ink-900">{s.assignedBy.name}</p>
                        <p className="text-[11px] uppercase tracking-wide text-ink-400">{s.assignedBy.role.replace(/_/g, " ").toLowerCase()}</p>
                      </td>
                      <td className="text-right">
                        <p className="font-semibold text-ink-900">{formatINR(s.totalPerMonth)}</p>
                        {s.includeGst && (
                          <p className="text-[11px] text-ink-400">{formatINR(s.rent)} + {formatINR(s.gstAmount)} GST</p>
                        )}
                      </td>
                      <td className="text-center text-xs text-ink-600">{s.billingDay}</td>
                      <td className="text-center">
                        <Badge variant={s.status === "ACTIVE" ? "success" : s.status === "CANCELLED" ? "danger" : "warning"}>
                          {s.status.toLowerCase()}
                        </Badge>
                      </td>
                      <td className="text-xs text-ink-500">{new Date(s.startedAt).toLocaleDateString("en-IN")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TablePro>
          )}

          {/* Invoice / payment history */}
          {showInvoices && myInvoices.length > 0 && (
            <div className="mt-4">
              <TablePro dense title="Payment history">
                <table>
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th>Machine</th>
                      <th>Plan</th>
                      <th className="text-right">Amount</th>
                      <th className="text-center">Status</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myInvoices.map((inv) => (
                      <tr key={inv.id}>
                        <td className="font-mono text-xs text-ink-700">{inv.periodKey}</td>
                        <td className="font-mono text-xs text-ink-700">{inv.machine.tid ?? inv.machine.serial ?? "—"}</td>
                        <td className="text-xs text-ink-600">{inv.planName}</td>
                        <td className="text-right">
                          <p className="font-semibold text-ink-900">{formatINR(inv.totalAmount)}</p>
                          {inv.gstAmount > 0 && <p className="text-[11px] text-ink-400">incl. {formatINR(inv.gstAmount)} GST</p>}
                        </td>
                        <td className="text-center">
                          <Badge variant={inv.status === "PAID" ? "success" : inv.status === "FAILED" ? "danger" : "default"}>
                            {inv.status.toLowerCase()}
                          </Badge>
                        </td>
                        <td className="text-xs text-ink-500">{inv.detail ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TablePro>
            </div>
          )}
        </Panel>
        </Reveal>
      )}

      {/* My Rental Plans management */}
      <Reveal distance={16} duration={0.45}>
      <Panel className="p-6">
        <div className="mb-4 flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-soft">
            <CreditCard className="h-4 w-4" />
          </span>
          <div>
            <h3 className="font-display text-base font-semibold text-ink-900">My Rental Plans</h3>
            <p className="mt-1 text-xs text-ink-500">
              Create your own rental plans, then assign them to your {meta.childLabelPlural.toLowerCase()} below. Platform plans from admin are also available to assign.
            </p>
          </div>
        </div>

        {/* Create / edit form */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1.6fr_1fr_auto] lg:items-end">
          <div>
            <label className={labelCls}>Plan Name *</label>
            <input className={inputCls} placeholder="e.g. My Standard POS" value={planForm.name}
              onChange={(e) => setPlanForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label className={labelCls}>Description</label>
            <input className={inputCls} placeholder="Optional" value={planForm.description}
              onChange={(e) => setPlanForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <div>
            <label className={labelCls}>Monthly Rent (₹) *</label>
            <input className={inputCls} type="number" min="0" step="0.01" placeholder="500" value={planForm.monthlyRent}
              onChange={(e) => setPlanForm((f) => ({ ...f, monthlyRent: e.target.value }))} />
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={planBusy || planForm.name.trim().length < 2 || !planForm.monthlyRent} onClick={savePlan}>
              {planBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : editingPlanId ? <CheckCircle2 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {editingPlanId ? "Update" : "Create"}
            </Button>
            {editingPlanId && (
              <Button size="sm" variant="outline" disabled={planBusy} onClick={resetPlanForm}>
                <X className="h-4 w-4" /> Cancel
              </Button>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-start gap-4">
          <label className="flex w-fit cursor-pointer items-center gap-2 rounded-xl border border-ink-200 bg-ink-50/60 px-3 py-2 text-sm">
            <input type="checkbox" checked={planForm.includeGst}
              onChange={(e) => setPlanForm((f) => ({ ...f, includeGst: e.target.checked }))}
              className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-400" />
            <span className="font-medium text-ink-700">Charge 18% GST on this plan</span>
            <span className="text-xs text-ink-400">(applied to rent &amp; commission by default)</span>
          </label>

          {/* Commission preview for the plan being created/edited */}
          {(() => {
            const pRent = Number(planForm.monthlyRent || 0);
            if (pRent <= 0) return null;
            const costs = Object.values(machineCosts);
            const avgCost = costs.length > 0 ? costs.reduce((a, b) => a + b, 0) / costs.length : 0;
            const spread = Math.max(0, Math.round((pRent - avgCost) * 100) / 100);
            if (spread <= 0) return null;
            const gstOnSpread = planForm.includeGst ? Math.round(spread * 0.18 * 100) / 100 : 0;
            const tds = Math.round(spread * 0.02 * 100) / 100;
            const net = Math.round((spread + gstOnSpread - tds) * 100) / 100;
            return (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-xs">
                <span className="font-semibold text-emerald-800">Commission preview</span>
                {avgCost > 0 && <span className="text-ink-500">Upstream: {formatINR(avgCost)}</span>}
                <span className="text-emerald-700">Spread: {formatINR(spread)}</span>
                {planForm.includeGst && <span className="text-emerald-700">+GST: {formatINR(gstOnSpread)}</span>}
                <span className="text-ink-500">−TDS 2%: {formatINR(tds)}</span>
                <span className="font-bold text-emerald-800">Net: {formatINR(net)}/machine/mo</span>
              </div>
            );
          })()}
        </div>

        {/* Own plans list */}
        <div className="mt-5">
          {ownPlans.length === 0 ? (
            <p className="rounded-xl border border-dashed border-ink-200 bg-ink-50/50 px-4 py-6 text-center text-sm text-ink-500">
              You haven&apos;t created any rental plans yet. Create one above to assign to your {meta.childLabelPlural.toLowerCase()}.
            </p>
          ) : (
            <TablePro dense>
              <table>
                <thead>
                  <tr>
                    <th>Plan</th>
                    <th className="text-right">Monthly Rent</th>
                    <th className="text-center">GST</th>
                    <th className="text-center">Status</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {ownPlans.map((p) => (
                    <tr key={p.id}>
                      <td className="font-semibold text-ink-900">{p.name}</td>
                      <td className="text-right font-semibold text-ink-900">{formatINR(p.monthlyRent)}</td>
                      <td className="text-center">
                        <Badge variant={p.includeGst ? "success" : "default"}>{p.includeGst ? "18% GST" : "No GST"}</Badge>
                      </td>
                      <td className="text-center">
                        <Badge variant={p.active ? "success" : "danger"}>{p.active ? "Active" : "Inactive"}</Badge>
                      </td>
                      <td>
                        <div className="flex items-center justify-end gap-2">
                          <Button size="sm" variant="outline" disabled={planBusy} onClick={() => startEditPlan(p)}>
                            <Pencil className="h-3.5 w-3.5" /> Edit
                          </Button>
                          <Button size="sm" variant="outline" disabled={planBusy} onClick={() => togglePlan(p)}>
                            {p.active ? "Deactivate" : "Activate"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TablePro>
          )}
        </div>
      </Panel>
      </Reveal>

      {/* Assign subscription panel */}
      <Reveal distance={16} duration={0.45}>
      <Panel className="p-6">
        <div className="mb-4 flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-accent-500 to-accent-700 text-white shadow-soft">
            <Plus className="h-4 w-4" />
          </span>
          <div>
            <h3 className="font-display text-base font-semibold text-ink-900">Assign Subscription to {meta.childLabel}</h3>
            <p className="mt-1 text-xs text-ink-500">
              Select a {meta.childLabel.toLowerCase()}, pick their machines, set a plan with rent & commission.
            </p>
          </div>
        </div>

        {/* Step 1: Select child */}
        <div className="mb-4">
          <label className={labelCls}>Select {meta.childLabel}</label>
          <select className={inputCls} value={selectedChild}
            onChange={(e) => setSelectedChild(e.target.value)}>
            <option value="">
              {childLoading ? `Loading ${meta.childLabelPlural.toLowerCase()}...` : `Choose a ${meta.childLabel.toLowerCase()}...`}
            </option>
            {children.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} — {c.shop !== "—" ? c.shop : c.city}
              </option>
            ))}
          </select>
        </div>

        {selectedChild && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
            {/* Left: Machines list */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className={labelCls}>Machines assigned to this {meta.childLabel.toLowerCase()}</label>
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
              ) : machines.length === 0 ? (
                <div className="rounded-xl border border-ink-100 bg-ink-50 p-6 text-center text-sm text-ink-500">
                  No machines assigned to this {meta.childLabel.toLowerCase()}. Assign machines from your <span className="font-semibold text-brand-700">Network</span> page first.
                </div>
              ) : (
                <div className="max-h-64 overflow-y-auto rounded-xl border border-ink-100">
                  {machines.map((m) => (
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
                  {assignablePlans.length === 0 && <option value="">No plans available</option>}
                  {assignablePlans.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} — {formatINR(p.monthlyRent)}/mo{p.isOwn ? " (yours)" : ""}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelCls}>Monthly Rent (₹)</label>
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

              {/* Commission breakdown (read-only, auto-calculated) */}
              {baseRent > 0 && selectedMachines.size > 0 && (
                <div className="rounded-xl border border-ink-100 bg-ink-50 p-4">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Monthly Summary</p>
                  <div className="space-y-1.5 text-sm">
                    {upstreamCost > 0 && (
                      <div className="flex items-center justify-between text-xs text-ink-500">
                        <span>Your upstream cost</span>
                        <span className="font-medium">{formatINR(upstreamCost)}/mo</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-xs text-ink-500">
                      <span>Rent charged to {meta.childLabel.toLowerCase()}</span>
                      <span className="font-semibold text-ink-700">{formatINR(totalPerMachine)}{includeGst ? " (incl. GST)" : ""}</span>
                    </div>
                    {selectedMachines.size > 1 && (
                      <div className="flex items-center justify-between text-xs text-ink-500">
                        <span>{selectedMachines.size} machines total</span>
                        <span className="font-semibold text-ink-700">{formatINR(totalPerMachine * selectedMachines.size)}</span>
                      </div>
                    )}
                    {commissionAmt > 0 && (
                      <>
                        <div className="border-t border-ink-200 pt-2" />
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-emerald-600">Your commission (spread)</span>
                          <span className="font-semibold text-emerald-700">{formatINR(commissionAmt)}/machine</span>
                        </div>
                        {includeGst && (
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-emerald-600">GST on commission (18%)</span>
                            <span className="font-semibold text-emerald-700">+{formatINR(commissionGst)}</span>
                          </div>
                        )}
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-ink-400">TDS (2%)</span>
                          <span className="text-ink-500">−{formatINR(tdsAmt)}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-emerald-700">Net credit to wallet</span>
                          <span className="font-bold text-emerald-700">{formatINR(netCommission * selectedMachines.size)}/mo</span>
                        </div>
                      </>
                    )}
                    {commissionAmt === 0 && upstreamCost > 0 && baseRent <= upstreamCost && (
                      <div className="border-t border-ink-200 pt-2">
                        <p className="text-xs text-amber-600">Rent must be higher than your upstream cost ({formatINR(upstreamCost)}) to earn commission.</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* No upstream subscription — full rent would be treated as commission */}
              {selectedMachines.size > 0 && machinesWithoutUpstream.length > 0 && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <p className="text-xs text-amber-700">
                    {machinesWithoutUpstream.length === selectedMachines.size
                      ? "No active upstream subscription found for the selected machine" + (machinesWithoutUpstream.length > 1 ? "s" : "")
                      : `${machinesWithoutUpstream.length} of the selected machines have no active upstream subscription`}
                    . Your upstream cost is treated as ₹0, so the <span className="font-semibold">full rent becomes your commission</span> and your upstream collects nothing. If you pay rent for {machinesWithoutUpstream.length > 1 ? "these machines" : "this machine"}, ask your upstream to set up your subscription first.
                  </p>
                </div>
              )}

              <Button className="w-full" size="sm" disabled={busy || !canAssign} onClick={assignSubscriptions}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Create {selectedMachines.size} Subscription{selectedMachines.size !== 1 ? "s" : ""}
              </Button>
            </div>
          </div>
        )}
      </Panel>
      </Reveal>

      {/* Stats */}
      <div className="flex flex-wrap items-stretch gap-4">
        <StatTile
          className="min-w-[200px] flex-1"
          label="Active"
          countTo={activeSubs.length}
          icon={CheckCircle2}
          tone="emerald"
          hint="Subscriptions billing your downline"
        />
        <StatTile
          className="min-w-[200px] flex-1"
          label="Monthly"
          countTo={totalActiveRent}
          prefix="₹"
          decimals={2}
          icon={IndianRupee}
          tone="brand"
          hint="Rent across active subscriptions"
        />
        <div className="flex items-center">
          <Button variant="outline" size="sm" onClick={refreshSubs}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {/* Subscriptions table */}
      <Reveal distance={16} duration={0.45}>
        <DataTable columns={columns} data={subs} loading={subsLoading}
          title="My Subscriptions"
          description={`${formatNumber(subs.length)} subscription${subs.length === 1 ? "" : "s"}`} />
      </Reveal>

      <ConfirmDialog
        open={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        busy={busy}
        title="Cancel this subscription?"
        description={
          cancelTarget && (
            <>
              Monthly billing for{" "}
              <span className="font-mono font-semibold text-ink-900">
                {cancelTarget.machine.tid ?? cancelTarget.machine.serial ?? "this machine"}
              </span>{" "}
              ({cancelTarget.user.name}) will stop.
            </>
          )
        }
        confirmLabel="Cancel subscription"
        cancelLabel="Keep"
        onConfirm={async () => {
          if (!cancelTarget) return;
          await cancelSub(cancelTarget.id);
          setCancelTarget(null);
        }}
      />
    </div>
  );
}
