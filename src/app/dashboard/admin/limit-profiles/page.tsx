"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/dashboard/ui";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";
import { RefreshCw, Gauge, Plus, Trash2, Save, X } from "lucide-react";

/**
 * Risk Tiers — the per-service daily-limit matrix that the risk engine enforces.
 * A user's tier is auto-derived from KYC/role (limits.tier_policy) unless an
 * admin pins one from Network Manager. Edits apply at runtime, no deploy.
 */

// Money-moving services that make sense to cap per rail. Keys must match the
// Prisma ServiceCode enum (plus "PAYOUT", which routes through PayoutRequest).
const SERVICE_OPTIONS = [
  "PAYOUT",
  "BILL_CREDIT_CARD",
  "DMT_IMPS",
  "DMT_NEFT",
  "DMT_RTGS",
  "UPI_PAYOUT",
  "AEPS_WITHDRAW",
  "WALLET_WITHDRAW",
  "BILL_ELECTRICITY",
  "BILL_WATER",
  "BILL_GAS",
  "BILL_EDUCATION",
  "BILL_INSURANCE",
  "RECHARGE_MOBILE",
  "RECHARGE_DTH",
  "RECHARGE_BROADBAND",
  "INSURANCE",
] as const;

type Tier = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  active: boolean;
  isDefault: boolean;
  dailyAmountCap: number | null;
  dailyCountCap: number | null;
  nightFactor: number | null;
  serviceCaps: Record<string, number>;
  assignedUsers: number;
};

const inputCls =
  "rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

const numOrNull = (s: string): number | null => {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

export default function RiskTiersPage() {
  const [tiers, setTiers] = useState<Tier[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const notify = useCallback((text: string, ok: boolean) => {
    if (ok) toast.success(text);
    else toast.error(text);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/limit-profiles");
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "Failed to load tiers");
      setTiers(d.profiles);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Load failed", false);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  const createTier = async (key: string) => {
    setCreating(true);
    try {
      const res = await fetch("/api/admin/limit-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, name: key.replace(/_/g, " ") }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(typeof d?.error === "string" ? d.error : "Create failed");
      notify(`Tier ${key} created.`, true);
      load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Create failed", false);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <Reveal distance={14} duration={0.4}>
        <PageHeader
          title="Risk Tiers"
          description="Per-service daily-limit tiers. Users are auto-assigned by KYC & role; pin a tier per user from Network Manager. Changes apply instantly — no deploy."
          actions={
            <div className="flex gap-2">
              <Button variant="outline" onClick={load}>
                <RefreshCw className="mr-2 h-4 w-4" /> Refresh
              </Button>
              <NewTierButton onCreate={createTier} busy={creating} />
            </div>
          }
        />
      </Reveal>

      {loading && !tiers && <p className="text-sm text-ink-400">Loading tiers…</p>}

      {tiers && tiers.length === 0 && (
        <Panel className="text-center">
          <p className="text-sm font-medium text-ink-700">No tiers yet.</p>
          <p className="mt-1 text-xs text-ink-400">Create your first tier to start capping rails.</p>
        </Panel>
      )}

      {tiers && tiers.length > 0 && (
        <Stagger stagger={0.05} className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {tiers.map((t) => (
            <StaggerItem key={t.id} distance={14} duration={0.35}>
              <TierCard tier={t} onSaved={load} notify={notify} />
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </div>
  );
}

function NewTierButton({
  onCreate,
  busy,
}: {
  onCreate: (key: string) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  if (!open)
    return (
      <Button onClick={() => setOpen(true)}>
        <Plus className="mr-2 h-4 w-4" /> New tier
      </Button>
    );
  return (
    <div className="flex items-center gap-2">
      <input
        autoFocus
        placeholder="KEY e.g. VIP"
        value={key}
        onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
        className={`${inputCls} w-36`}
      />
      <Button
        size="sm"
        disabled={busy || key.length < 2}
        onClick={() => {
          onCreate(key);
          setOpen(false);
          setKey("");
        }}
      >
        Create
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

function TierCard({
  tier,
  onSaved,
  notify,
}: {
  tier: Tier;
  onSaved: () => void;
  notify: (t: string, ok: boolean) => void;
}) {
  const [name, setName] = useState(tier.name);
  const [description, setDescription] = useState(tier.description ?? "");
  const [active, setActive] = useState(tier.active);
  const [isDefault, setIsDefault] = useState(tier.isDefault);
  const [dailyAmountCap, setDailyAmountCap] = useState(
    tier.dailyAmountCap != null ? String(tier.dailyAmountCap) : ""
  );
  const [dailyCountCap, setDailyCountCap] = useState(
    tier.dailyCountCap != null ? String(tier.dailyCountCap) : ""
  );
  const [nightFactor, setNightFactor] = useState(
    tier.nightFactor != null ? String(tier.nightFactor) : ""
  );
  const [caps, setCaps] = useState<{ service: string; amount: string }[]>(
    Object.entries(tier.serviceCaps).map(([service, amount]) => ({
      service,
      amount: String(amount),
    }))
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const usedServices = useMemo(() => new Set(caps.map((c) => c.service)), [caps]);
  const available = SERVICE_OPTIONS.filter((s) => !usedServices.has(s));

  const addCap = () => {
    if (available.length === 0) return;
    setCaps((prev) => [...prev, { service: available[0], amount: "0" }]);
  };

  const save = async () => {
    // Build the service-cap map, dropping incomplete rows.
    const serviceCaps: Record<string, number> = {};
    for (const c of caps) {
      const n = Number(c.amount);
      if (c.service && Number.isFinite(n) && n >= 0) serviceCaps[c.service] = n;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/limit-profiles/${tier.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: description || null,
          active,
          isDefault,
          dailyAmountCap: numOrNull(dailyAmountCap),
          dailyCountCap: numOrNull(dailyCountCap),
          nightFactor: numOrNull(nightFactor),
          serviceCaps,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(typeof d?.error === "string" ? d.error : "Save failed");
      notify(`${tier.key} saved.`, true);
      onSaved();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Save failed", false);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete tier "${tier.key}"? Pinned users revert to auto-tiering.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/limit-profiles/${tier.id}`, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof d?.error === "string" ? d.error : "Delete failed");
      notify(`${tier.key} deleted.`, true);
      onSaved();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Delete failed", false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Panel className="h-full">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-soft">
          <Gauge className="h-4 w-4" />
        </span>
        <div className="flex-1">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border-0 bg-transparent p-0 font-display text-sm font-bold text-ink-900 outline-none"
          />
          <p className="text-[11px] text-ink-400">
            {tier.key} · {tier.assignedUsers} pinned user{tier.assignedUsers === 1 ? "" : "s"}
          </p>
        </div>
        {isDefault && (
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
            Default
          </span>
        )}
      </div>

      <input
        placeholder="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className={`${inputCls} mb-3 w-full`}
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <label className="block text-xs text-ink-500">
          Overall daily cap (₹)
          <input
            type="number"
            placeholder="Platform default"
            value={dailyAmountCap}
            onChange={(e) => setDailyAmountCap(e.target.value)}
            className={`${inputCls} mt-1 w-full`}
          />
        </label>
        <label className="block text-xs text-ink-500">
          Daily count cap
          <input
            type="number"
            placeholder="No cap"
            value={dailyCountCap}
            onChange={(e) => setDailyCountCap(e.target.value)}
            className={`${inputCls} mt-1 w-full`}
          />
        </label>
        <label className="block text-xs text-ink-500">
          Night factor (0–1)
          <input
            type="number"
            step="0.1"
            placeholder="Default 0.5"
            value={nightFactor}
            onChange={(e) => setNightFactor(e.target.value)}
            className={`${inputCls} mt-1 w-full`}
          />
        </label>
      </div>

      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-xs font-medium text-ink-600">Per-service daily caps (₹ · 0 = rail off)</p>
          <Button size="sm" variant="ghost" disabled={available.length === 0} onClick={addCap}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add
          </Button>
        </div>
        {caps.length === 0 && (
          <p className="text-[11px] text-ink-400">
            No per-service caps — only the overall daily cap applies.
          </p>
        )}
        <div className="space-y-1.5">
          {caps.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <select
                value={c.service}
                onChange={(e) =>
                  setCaps((prev) =>
                    prev.map((x, j) => (j === i ? { ...x, service: e.target.value } : x))
                  )
                }
                className={`${inputCls} flex-1`}
              >
                <option value={c.service}>{c.service}</option>
                {available.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <input
                type="number"
                value={c.amount}
                onChange={(e) =>
                  setCaps((prev) =>
                    prev.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x))
                  )
                }
                className={`${inputCls} w-32`}
              />
              <button
                type="button"
                onClick={() => setCaps((prev) => prev.filter((_, j) => j !== i))}
                className="rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-ink-100 pt-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-700">
          <input
            type="checkbox"
            className="h-4 w-4 accent-brand-600"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          Active
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-700">
          <input
            type="checkbox"
            className="h-4 w-4 accent-brand-600"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
          />
          Default tier
        </label>
        <div className="ml-auto flex gap-2">
          {!tier.isDefault && (
            <Button size="sm" variant="ghost" disabled={deleting} onClick={remove}>
              <Trash2 className="mr-1 h-4 w-4" /> Delete
            </Button>
          )}
          <Button size="sm" disabled={saving} onClick={save}>
            <Save className="mr-1 h-4 w-4" /> Save
          </Button>
        </div>
      </div>
    </Panel>
  );
}
