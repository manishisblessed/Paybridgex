"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Button } from "@/components/ui/Button";
import { RefreshCw, SlidersHorizontal, Save } from "lucide-react";

/**
 * Platform Controls — generic editor over the PlatformSetting store.
 * Each setting is a small JSON object; we render boolean and numeric fields
 * automatically so newly-added settings appear here with zero UI changes.
 */

type SettingsMap = Record<string, Record<string, unknown>>;

const LABELS: Record<string, { title: string; description: string }> = {
  "wallet.global_cap": {
    title: "Wallet cap",
    description: "Maximum primary-wallet balance any network user may hold.",
  },
  "wallet.ops_approval_threshold": {
    title: "Wallet ops approval threshold (inactive)",
    description: "No longer enforced — admin push/pull executes immediately for any authorized admin, regardless of amount.",
  },
  "reversal.approval_threshold": {
    title: "Reversal approval threshold (inactive)",
    description: "No longer enforced — reversals execute immediately for any authorized admin, regardless of amount.",
  },
  "settlement.t1": {
    title: "T+1 settlement engine",
    description: "Daily AEPS → primary wallet sweep. Also controllable from Settlement Ops.",
  },
  "pos.rental_billing": {
    title: "POS rental billing",
    description: "Monthly rent auto-debit for POS subscriptions.",
  },
  "limits.settlement_defaults": {
    title: "Default settlement limits",
    description: "Daily / per-transfer settlement caps for users without a custom limit.",
  },
  "pos.card_classification": {
    title: "Card classification (tier)",
    description:
      "When OFF, MDR is priced on Card Category (Credit/Debit/Prepaid) instead of the card tier — the tier dimension is ignored in scheme/brand rates, tier-pinned slabs go dormant, and the BIN checker stops running. 'Show in UI' controls whether the Classification column appears in POS transactions.",
  },
};

const FIELD_LABELS: Record<string, string> = {
  enabled: "Enabled",
  showInUi: "Show in UI",
  paused: "Paused",
  amount: "Amount (₹)",
  hour: "Run hour (IST, 0–23)",
  minAmount: "Minimum amount (₹)",
  dailyCap: "Daily cap (₹)",
  perTxnCap: "Per-transfer cap (₹)",
};

const inputCls =
  "rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

export default function PlatformControlsPage() {
  const [settings, setSettings] = useState<SettingsMap | null>(null);
  const [drafts, setDrafts] = useState<SettingsMap>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const notify = useCallback((text: string, ok: boolean) => {
    if (ok) toast.success(text);
    else toast.error(text);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/platform-settings");
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "Failed to load settings");
      setSettings(d.settings);
      setDrafts(JSON.parse(JSON.stringify(d.settings)));
    } catch (e) {
      notify(e instanceof Error ? e.message : "Load failed", false);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (key: string) => {
    setSavingKey(key);
    try {
      const res = await fetch("/api/admin/platform-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: drafts[key] }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(typeof d?.error === "string" ? d.error : "Save failed");
      notify(`${LABELS[key]?.title ?? key} saved.`, true);
      load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Save failed", false);
    } finally {
      setSavingKey(null);
    }
  };

  const setField = (key: string, field: string, value: unknown) =>
    setDrafts((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));

  const isDirty = (key: string) =>
    settings && JSON.stringify(settings[key]) !== JSON.stringify(drafts[key]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform Controls"
        description="Runtime-changeable operational knobs — caps, thresholds, and engine switches. Changes apply instantly, no deploy needed. Master Admin only."
        actions={
          <Button variant="outline" onClick={load}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
        }
      />

      {loading && !settings && <p className="text-sm text-ink-400">Loading settings…</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {settings &&
          Object.keys(settings).map((key) => {
            const meta = LABELS[key] ?? { title: key, description: "" };
            const draft = drafts[key] ?? {};
            return (
              <div key={key} className="rounded-2xl border border-ink-100 bg-white p-5">
                <div className="mb-1 flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4 text-brand-600" />
                  <h3 className="text-sm font-bold text-ink-900">{meta.title}</h3>
                </div>
                <p className="mb-4 text-xs text-ink-400">{meta.description}</p>

                <div className="space-y-3">
                  {Object.entries(draft).map(([field, value]) => {
                    const label = FIELD_LABELS[field] ?? field;
                    if (typeof value === "boolean") {
                      return (
                        <label key={field} className="flex items-center gap-2 text-sm text-ink-700">
                          <input
                            type="checkbox"
                            checked={value}
                            onChange={(e) => setField(key, field, e.target.checked)}
                          />
                          {label}
                        </label>
                      );
                    }
                    if (typeof value === "number") {
                      return (
                        <label key={field} className="block text-xs text-ink-500">
                          {label}
                          <input
                            type="number"
                            className={`${inputCls} mt-1 block w-48`}
                            value={value}
                            onChange={(e) => setField(key, field, Number(e.target.value))}
                          />
                        </label>
                      );
                    }
                    return null;
                  })}
                </div>

                <Button
                  className="mt-4"
                  size="sm"
                  disabled={savingKey === key || !isDirty(key)}
                  onClick={() => save(key)}
                >
                  <Save className="mr-1.5 h-3.5 w-3.5" />
                  {savingKey === key ? "Saving…" : isDirty(key) ? "Save changes" : "Saved"}
                </Button>
              </div>
            );
          })}
      </div>
    </div>
  );
}
