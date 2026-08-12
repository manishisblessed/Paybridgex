"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input, Label, Select } from "@/components/ui/Input";
import { SERVICE_CODES, serviceGroup } from "@/lib/scheme/constants";
import { BBPS_PRICE_SCOPES, BBPS_PRICE_SCOPE_OPTIONS } from "@/lib/services/priceScope";
import {
  ArrowLeft,
  Plus,
  Star,
  Loader2,
  Trash2,
  Pencil,
  X,
  Users,
  UserPlus,
  Power,
} from "lucide-react";

type RateType = "FLAT" | "PERCENT";

type Slab = {
  id: string;
  schemeId: string;
  service: string;
  /** Provider dimension (null = any provider). */
  provider: string | null;
  minAmount: number;
  maxAmount: number;
  chargeType: RateType;
  chargeValue: number;
  /** true = chargeValue already includes 18% GST; false = GST added on top. */
  chargeGstInclusive: boolean;
  /** Vendor/upstream cost locked from the BBPS/Payout rate card (0 = none). */
  vendorCharge: number;
  /** Live vendor cost resolved from the CURRENT rate card (null = no card). */
  vendorChargeLive?: number | null;
  /** Live minimum charge from the current rate card (null = no card). */
  minChargeLive?: number | null;
  commissionType: RateType;
  /** Cascade model: commission the ASSIGNED user earns on this slab. */
  commissionValue: number;
  active: boolean;
};

type Scheme = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  isDefault: boolean;
  slabs?: Slab[];
};

type AssignedUser = { id: string; name: string; email: string; role: string };

export default function SchemeEditorPage() {
  const params = useParams<{ id: string }>();
  const schemeId = params.id;

  const [scheme, setScheme] = useState<Scheme | null>(null);
  const [slabs, setSlabs] = useState<Slab[]>([]);
  const [assigned, setAssigned] = useState<AssignedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const notify = useCallback((text: string, ok: boolean) => {
    if (ok) toast.success(text);
    else toast.error(text);
  }, []);

  const [slabModal, setSlabModal] = useState<{ open: boolean; editing: Slab | null }>({ open: false, editing: null });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/schemes/${schemeId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to load");
      setScheme(data.scheme);
      setSlabs(data.scheme.slabs ?? []);
      setAssigned(data.assignedUsers ?? []);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed to load", false);
    } finally {
      setLoading(false);
    }
  }, [schemeId, notify]);

  useEffect(() => {
    load();
  }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, Slab[]>();
    for (const s of slabs) {
      const arr = map.get(s.service) ?? [];
      arr.push(s);
      map.set(s.service, arr);
    }
    return Array.from(map.entries())
      .map(([service, list]) => [service, list.sort((a, b) => a.minAmount - b.minAmount)] as const)
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [slabs]);

  async function deleteSlab(slab: Slab) {
    try {
      const res = await fetch(`/api/admin/schemes/${schemeId}/slabs/${slab.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Delete failed");
      notify("Slab removed.", true);
      load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Delete failed", false);
    }
  }

  async function patchScheme(body: Record<string, unknown>, okMsg: string) {
    try {
      const res = await fetch(`/api/admin/schemes/${schemeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "Update failed");
      notify(okMsg, true);
      load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Update failed", false);
    }
  }

  if (loading && !scheme) {
    return (
      <div className="rounded-2xl border border-ink-100 bg-white p-10 text-center text-sm text-ink-500">
        Loading scheme…
      </div>
    );
  }

  if (!scheme) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/admin/schemes" className="inline-flex items-center gap-1 text-sm text-brand-700">
          <ArrowLeft className="h-4 w-4" /> Back to schemes
        </Link>
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">Scheme not found.</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/dashboard/admin/schemes" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800">
        <ArrowLeft className="h-4 w-4" /> Back to schemes
      </Link>

      <PageHeader
        eyebrow="Scheme Manager"
        title={scheme.name}
        description={scheme.description ?? "Per-service charge & commission slabs."}
        actions={
          <>
            {!scheme.isDefault && (
              <Button variant="outline" onClick={() => patchScheme({ isDefault: true }, "Marked as default scheme.")}>
                <Star className="h-4 w-4" /> Set default
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => patchScheme({ active: !scheme.active }, scheme.active ? "Scheme deactivated." : "Scheme activated.")}
            >
              <Power className="h-4 w-4" /> {scheme.active ? "Deactivate" : "Activate"}
            </Button>
            <Button onClick={() => setSlabModal({ open: true, editing: null })}>
              <Plus className="h-4 w-4" /> Add slab
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {scheme.isDefault && (
          <Badge variant="accent">
            <Star className="h-3 w-3" /> Platform default
          </Badge>
        )}
        <Badge variant={scheme.active ? "success" : "danger"}>{scheme.active ? "Active" : "Inactive"}</Badge>
        <Badge variant="brand">{slabs.length} slabs</Badge>
        <Badge variant="default">{assigned.length} users assigned</Badge>
      </div>

      {/* Slab grid grouped by service */}
      {grouped.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-ink-200 bg-white p-10 text-center">
          <p className="text-sm font-semibold text-ink-700">No slabs yet</p>
          <p className="mt-1 text-sm text-ink-500">Add per-service amount ranges with their charge and commission split.</p>
          <div className="mt-4 flex justify-center">
            <Button onClick={() => setSlabModal({ open: true, editing: null })}>
              <Plus className="h-4 w-4" /> Add slab
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([service, list]) => (
            <section key={service} className="overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-ink-100 bg-ink-50/60 px-5 py-3">
                <div>
                  <h3 className="font-display text-sm font-semibold text-ink-900">{service.replace(/_/g, " ")}</h3>
                  <p className="text-xs text-ink-500">{serviceGroup(service)}</p>
                </div>
                <Badge variant="brand">{list.length} slabs</Badge>
              </div>
              <div className="w-full overflow-x-auto">
                <table className="w-full min-w-max text-sm">
                  <thead className="bg-ink-50/40 text-left text-[11px] uppercase tracking-wider text-ink-500">
                    <tr>
                      <th className="px-5 py-2.5 font-semibold">Range</th>
                      <th className="px-5 py-2.5 font-semibold">Provider</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Charge</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Vendor / txn</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Revenue / txn</th>
                      <th className="px-5 py-2.5 text-right font-semibold">User Commission</th>
                      <th className="px-5 py-2.5 text-center font-semibold">Status</th>
                      <th className="px-5 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100 text-ink-800">
                    {list.map((s) => (
                      <tr key={s.id} className="transition-colors hover:bg-brand-50/40">
                        <td className="px-5 py-3 font-medium">
                          ₹{s.minAmount.toLocaleString("en-IN")} – ₹{s.maxAmount.toLocaleString("en-IN")}
                        </td>
                        <td className="px-5 py-3 text-xs">{s.provider ?? "All"}</td>
                        <td className="px-5 py-3 text-right">
                          {fmtRate(s.chargeType, s.chargeValue)}
                          <span className={`ml-1.5 inline-block rounded px-1 py-0.5 text-[10px] font-semibold leading-none ${s.chargeGstInclusive ? "bg-amber-100 text-amber-700" : "bg-sky-100 text-sky-700"}`}>
                            {s.chargeGstInclusive ? "incl. GST" : "+ GST"}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right">{fmtVendor(s)}</td>
                        <td className="px-5 py-3 text-right">{fmtRevenue(s)}</td>
                        <td className="px-5 py-3 text-right font-semibold text-emerald-700">{fmtRate(s.commissionType, s.commissionValue)}</td>
                        <td className="px-5 py-3 text-center">
                          <Badge variant={s.active ? "success" : "danger"}>{s.active ? "On" : "Off"}</Badge>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="flex justify-end gap-1">
                            <button
                              onClick={() => setSlabModal({ open: true, editing: s })}
                              className="grid h-8 w-8 place-items-center rounded-lg text-brand-600 hover:bg-brand-50"
                              title="Edit slab"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => deleteSlab(s)}
                              className="grid h-8 w-8 place-items-center rounded-lg text-rose-600 hover:bg-rose-50"
                              title="Delete slab"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}

      <AssignmentPanel
        schemeId={schemeId}
        assigned={assigned}
        onChange={(msg) => {
          notify(msg, true);
          load();
        }}
        onError={(msg) => notify(msg, false)}
      />

      {slabModal.open && (
        <SlabModal
          schemeId={schemeId}
          editing={slabModal.editing}
          onClose={() => setSlabModal({ open: false, editing: null })}
          onSaved={(msg) => {
            setSlabModal({ open: false, editing: null });
            notify(msg, true);
            load();
          }}
        />
      )}
    </div>
  );
}

function fmtRate(type: RateType, value: number): string {
  if (value === 0) return "—";
  return type === "FLAT" ? `₹${value.toLocaleString("en-IN")}` : `${(value * 100).toFixed(2)}%`;
}

/**
 * Effective vendor cost for a slab: the live rate-card value when available
 * (never stale), else the save-time snapshot. null when neither is set.
 */
function effectiveVendor(s: Slab): number {
  const live = s.vendorChargeLive;
  return live != null ? live : s.vendorCharge;
}

/**
 * Vendor cost per txn from the service rate card (BBPS/Payout). Shows the min
 * charge as a sub-line. Dash for services with no rate card / non-flat charge.
 */
function fmtVendor(s: Slab) {
  const vendor = effectiveVendor(s);
  if (vendor <= 0 || s.chargeType !== "FLAT") {
    return <span className="text-ink-300">—</span>;
  }
  return (
    <div className="leading-tight">
      <span className="font-semibold text-amber-600">₹{vendor.toLocaleString("en-IN")}</span>
      {s.minChargeLive != null && s.minChargeLive > 0 && (
        <div className="text-[10px] text-ink-400">min ₹{s.minChargeLive.toLocaleString("en-IN")}</div>
      )}
    </div>
  );
}

/**
 * Company revenue per transaction = customer charge − vendor cost. Only applies
 * to flat ₹/txn service rails (BBPS/Payout) with a vendor cost from the rate
 * card; everything else has no vendor basis, so it renders a dash. Services pay
 * no commission, so this whole spread is the company's revenue.
 */
function fmtRevenue(s: Slab) {
  const vendor = effectiveVendor(s);
  if (vendor <= 0 || s.chargeType !== "FLAT") {
    return <span className="text-ink-300">—</span>;
  }
  const revenue = Math.max(s.chargeValue - vendor, 0);
  return (
    <div className="leading-tight">
      <span className="font-semibold text-brand-700">₹{revenue.toLocaleString("en-IN")}</span>
      <div className="text-[10px] text-ink-400">charge ₹{s.chargeValue.toLocaleString("en-IN")}</div>
    </div>
  );
}

function SlabModal({
  schemeId,
  editing,
  onClose,
  onSaved,
}: {
  schemeId: string;
  editing: Slab | null;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const isEdit = !!editing;
  const [service, setService] = useState<string>(editing?.service ?? SERVICE_CODES[0]);
  const [provider, setProvider] = useState(editing?.provider ?? "");
  const [minAmount, setMinAmount] = useState(String(editing?.minAmount ?? 0));
  const [maxAmount, setMaxAmount] = useState(String(editing?.maxAmount ?? 1000));
  // BBPS/Payout service slabs are always flat ₹ (never a percentage). Types are
  // locked to FLAT; only MDR (POS/PG/QR) uses percentages, edited elsewhere.
  const chargeType: RateType = "FLAT";
  const [chargeValue, setChargeValue] = useState(String(editing?.chargeValue ?? 0));
  const [chargeGstInclusive, setChargeGstInclusive] = useState(editing?.chargeGstInclusive ?? false);
  const commissionType: RateType = "FLAT";
  // Cascade model: commission the assigned user earns on this slab (flat ₹).
  const [comOwn, setComOwn] = useState(String(editing?.commissionValue ?? 0));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Live rate-card preview (BBPS/Payout): the vendor cost + minimum for the
  // selected product, so the admin sees revenue = charge − vendor and can't
  // save below the minimum. Resolved server-side (exact scope → family).
  const [vendorInfo, setVendorInfo] = useState<{ vendorCharge: number; minCharge: number } | null>(null);
  const [vendorLoading, setVendorLoading] = useState(false);
  // BBPS product scopes that actually have an active rate card, so the Product
  // dropdown only offers priceable products (null = not yet loaded / N/A).
  const [cardedScopes, setCardedScopes] = useState<Set<string> | null>(null);

  // Which product scopes have a rate card (BBPS only) — refreshed per service.
  useEffect(() => {
    const bbps = service.startsWith("BILL_") || service === "RECHARGE_BROADBAND";
    if (!bbps) {
      setCardedScopes(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/rails/BBPS");
        const data = await res.json();
        if (!cancelled && res.ok && Array.isArray(data.providers)) {
          setCardedScopes(
            new Set<string>(
              data.providers
                .filter((p: { rateCount?: number }) => (p.rateCount ?? 0) > 0)
                .map((p: { scopeKey: string }) => p.scopeKey)
            )
          );
        }
      } catch {
        /* leave unfiltered on failure */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [service]);

  // Live vendor cost + minimum for the chosen product + amount (debounced).
  useEffect(() => {
    const serviceRail =
      service.startsWith("BILL_") || service === "RECHARGE_BROADBAND" || service === "PAYOUT";
    if (!serviceRail || !provider) {
      setVendorInfo(null);
      return;
    }
    const amt = Number(minAmount) || 0;
    let cancelled = false;
    setVendorLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/admin/schemes/vendor-preview?service=${encodeURIComponent(service)}&provider=${encodeURIComponent(provider)}&amount=${amt}`
        );
        const data = await res.json();
        if (!cancelled) {
          setVendorInfo(
            res.ok && data.vendorCharge != null
              ? { vendorCharge: data.vendorCharge, minCharge: data.minCharge ?? data.vendorCharge }
              : null
          );
        }
      } catch {
        if (!cancelled) setVendorInfo(null);
      } finally {
        if (!cancelled) setVendorLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [service, provider, minAmount]);

  function toStored(type: RateType, raw: string): number {
    const n = Number(raw);
    if (!isFinite(n) || n < 0) return 0;
    return type === "PERCENT" ? n / 100 : n;
  }

  async function submit() {
    setError(null);
    const min = Number(minAmount);
    const max = Number(maxAmount);
    if (!isFinite(min) || !isFinite(max) || min < 0 || max < 0) {
      setError("Enter valid amounts.");
      return;
    }
    if (max < min) {
      setError("Max amount must be ≥ min amount.");
      return;
    }
    // Services earn no commission — the charge must at least cover the vendor
    // cost + the product minimum, else there is no revenue. Enforce client-side
    // for instant feedback (the server re-validates authoritatively).
    const chargeNum = Number(chargeValue);
    if (vendorInfo && chargeType === "FLAT" && chargeNum + 1e-6 < vendorInfo.minCharge) {
      setError(`Customer charge must be at least ₹${vendorInfo.minCharge.toLocaleString("en-IN")} (the product minimum).`);
      return;
    }
    setSaving(true);

    const payload = {
      service,
      provider: provider.trim() || null,
      minAmount: min,
      maxAmount: max,
      chargeType,
      chargeValue: toStored(chargeType, chargeValue),
      chargeGstInclusive,
      commissionType,
      commissionValue: toStored(commissionType, comOwn),
    };

    try {
      const url = isEdit
        ? `/api/admin/schemes/${schemeId}/slabs/${editing!.id}`
        : `/api/admin/schemes/${schemeId}/slabs`;
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        // On edit we don't resend `service` (immutable per slab) but the PATCH ignores it.
        body: JSON.stringify(isEdit ? { ...payload, service: undefined } : payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "Save failed");
      onSaved(isEdit ? "Slab updated." : "Slab added.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const flatHint = "Flat ₹ amount per transaction";

  // BBPS/CC services are priced per PRODUCT: pin the slab to a product scope
  // (ServiceRoute key) so two products on the same partner (e.g. Bharat BillPay
  // vs the CC-only RechargeKit rail) hold independent charges + revenue. Credit
  // card is served by the SameDay CC rails; utilities by Bharat BillPay/Unified.
  const isBbpsService = service.startsWith("BILL_") || service === "RECHARGE_BROADBAND";
  const scopeKeys: string[] =
    service === "BILL_CREDIT_CARD"
      ? [BBPS_PRICE_SCOPES.BBPS_SAMEDAY, BBPS_PRICE_SCOPES.BBPS_CREDIT_CARD, BBPS_PRICE_SCOPES.RECHARGEKIT_CC]
      : [BBPS_PRICE_SCOPES.BBPS_SAMEDAY, BBPS_PRICE_SCOPES.BBPS_BULKPE];
  const scopeOptionsAll = BBPS_PRICE_SCOPE_OPTIONS.filter((o) => scopeKeys.includes(o.key));
  // Only offer products that have an active rate card (so a slab always locks a
  // vendor cost); always keep the currently-pinned value when editing. Falls
  // back to all products if the card list hasn't loaded.
  const scopeOptions = cardedScopes
    ? scopeOptionsAll.filter((o) => cardedScopes.has(o.key) || o.key === provider)
    : scopeOptionsAll;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-900/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-ink-100 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-ink-100 bg-gradient-to-r from-brand-500 to-sky-500 px-5 py-4 text-white">
          <h3 className="font-display text-base font-semibold">{isEdit ? "Edit slab" : "Add slab"}</h3>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-white/20">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

          <div>
            <Label>Service</Label>
            <Select value={service} onChange={(e) => setService(e.target.value)} disabled={isEdit}>
              {SERVICE_CODES.map((c) => (
                <option key={c} value={c}>
                  {c.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
            {isEdit && <p className="mt-1 text-xs text-ink-400">Service is fixed for an existing slab.</p>}
          </div>

          <div>
            <Label>{isBbpsService ? "Product (optional)" : "Provider (optional)"}</Label>
            {isBbpsService ? (
              <>
                <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
                  <option value="">All products</option>
                  {scopeOptions.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.name}
                      {o.partner ? ` · ${o.partner}` : ""}
                    </option>
                  ))}
                  {provider && !scopeOptions.some((o) => o.key === provider) && (
                    <option value={provider}>{provider} (current)</option>
                  )}
                </Select>
                <p className="mt-1 text-xs text-ink-400">
                  Pin the charge to a BBPS product so each product (Bharat BillPay, Credit Card, Unified, CC-2) is
                  priced and reported separately. Leave &quot;All products&quot; to apply to any.
                </p>
              </>
            ) : (
              <>
                <Input
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  placeholder="Leave blank for all providers"
                />
                <p className="mt-1 text-xs text-ink-400">
                  A slab pinned to a provider (e.g. a specific BBPS partner) wins over the all-provider slab.
                </p>
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Min amount (₹)</Label>
              <Input type="number" min={0} value={minAmount} onChange={(e) => setMinAmount(e.target.value)} />
            </div>
            <div>
              <Label>Max amount (₹)</Label>
              <Input type="number" min={0} value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} />
            </div>
          </div>

          <div className="rounded-xl border border-ink-100 bg-ink-50/40 p-3">
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-ink-500">Customer charge</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Type</Label>
                <Select value={chargeType} disabled>
                  <option value="FLAT">Flat (₹)</option>
                </Select>
              </div>
              <div>
                <Label>Charge (₹)</Label>
                <Input type="number" min={0} step="0.0001" value={chargeValue} onChange={(e) => setChargeValue(e.target.value)} />
              </div>
            </div>
            <div className="mt-3">
              <Label>GST</Label>
              <Select
                value={chargeGstInclusive ? "inclusive" : "exclusive"}
                onChange={(e) => setChargeGstInclusive(e.target.value === "inclusive")}
              >
                <option value="exclusive">Excl. GST (18% GST added on top)</option>
                <option value="inclusive">Incl. GST (charge already includes GST)</option>
              </Select>
            </div>
            <p className="mt-1 text-xs text-ink-400">
              {chargeGstInclusive
                ? "The charge value you entered already includes 18% GST. No additional GST will be applied."
                : flatHint + ". 18% GST will be added on top."}
            </p>
          </div>

          {/* Live rate-card preview — vendor cost, minimum, and company revenue */}
          {(isBbpsService || service === "PAYOUT") && provider && (
            <div className="rounded-xl border border-brand-100 bg-brand-50/40 p-3">
              <p className="mb-2 text-xs font-bold uppercase tracking-widest text-brand-700">
                Revenue preview {vendorLoading && <span className="text-ink-400">· loading…</span>}
              </p>
              {vendorInfo ? (
                (() => {
                  const charge = Number(chargeValue) || 0;
                  const revenue = Math.max(charge - vendorInfo.vendorCharge, 0);
                  const belowMin = charge + 1e-6 < vendorInfo.minCharge;
                  return (
                    <div className="space-y-1.5">
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-lg bg-white p-2">
                          <p className="text-[10px] uppercase tracking-wider text-ink-400">Vendor / txn</p>
                          <p className="font-semibold text-amber-600">₹{vendorInfo.vendorCharge.toLocaleString("en-IN")}</p>
                        </div>
                        <div className="rounded-lg bg-white p-2">
                          <p className="text-[10px] uppercase tracking-wider text-ink-400">Min charge</p>
                          <p className="font-semibold text-ink-700">₹{vendorInfo.minCharge.toLocaleString("en-IN")}</p>
                        </div>
                        <div className="rounded-lg bg-white p-2">
                          <p className="text-[10px] uppercase tracking-wider text-ink-400">Revenue / txn</p>
                          <p className="font-bold text-brand-700">₹{revenue.toLocaleString("en-IN")}</p>
                        </div>
                      </div>
                      {belowMin ? (
                        <p className="text-xs font-medium text-rose-600">
                          Charge is below the ₹{vendorInfo.minCharge.toLocaleString("en-IN")} minimum — raise it to save.
                        </p>
                      ) : (
                        <p className="text-[11px] text-ink-400">
                          Company revenue = customer charge − vendor cost (no commission on services).
                        </p>
                      )}
                    </div>
                  );
                })()
              ) : (
                <p className="text-xs text-ink-500">
                  {vendorLoading
                    ? "Resolving the product's rate card…"
                    : "No rate card found for this product — the slab will earn the whole charge as revenue. Add a vendor rate in MDR & minimum charges to track cost."}
                </p>
              )}
            </div>
          )}

          <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-3">
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-emerald-700">User commission</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Type</Label>
                <Select value={commissionType} disabled>
                  <option value="FLAT">Flat (₹)</option>
                </Select>
              </div>
              <div>
                <Label>Commission (₹)</Label>
                <Input type="number" min={0} step="0.0001" value={comOwn} onChange={(e) => setComOwn(e.target.value)} />
              </div>
            </div>
            <p className="mt-1 text-xs text-ink-400">
              {flatHint}. This is what the user this scheme is
              assigned to earns — parents up the chain earn scheme-difference margins automatically.
            </p>
          </div>
        </div>
        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-ink-100 bg-white px-5 py-4">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {isEdit ? "Save" : "Add slab"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function AssignmentPanel({
  schemeId,
  assigned,
  onChange,
  onError,
}: {
  schemeId: string;
  assigned: AssignedUser[];
  onChange: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [assigningAll, setAssigningAll] = useState(false);
  const [assignAllConfirmOpen, setAssignAllConfirmOpen] = useState(false);
  const [sdList, setSdList] = useState<{ id: string; name: string; email: string; shopName: string | null }[]>([]);
  const [loadingSd, setLoadingSd] = useState(true);

  const assignedIds = useMemo(() => new Set(assigned.map((u) => u.id)), [assigned]);

  const loadSuperDistributors = useCallback(async () => {
    setLoadingSd(true);
    try {
      const res = await fetch("/api/admin/users?role=super-distributor&pageSize=200");
      const data = await res.json();
      if (res.ok)
        setSdList(
          (data.users ?? []).map((u: { id: string; name: string; email: string; shopName: string | null }) => ({
            id: u.id,
            name: u.name,
            email: u.email,
            shopName: u.shopName,
          }))
        );
    } catch {
      /* silent */
    } finally {
      setLoadingSd(false);
    }
  }, []);

  useEffect(() => {
    loadSuperDistributors();
  }, [loadSuperDistributors]);

  async function assignAll() {
    setAssigningAll(true);
    try {
      const res = await fetch("/api/admin/schemes/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schemeId, role: "SUPER_DISTRIBUTOR" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "Assign failed");
      onChange(`Assigned to ${data.updated} super distributor(s).`);
      loadSuperDistributors();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Assign failed");
    } finally {
      setAssigningAll(false);
    }
  }

  async function assignUser(userId: string) {
    try {
      const res = await fetch("/api/admin/schemes/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schemeId, userIds: [userId] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "Assign failed");
      onChange("Super distributor assigned to scheme.");
    } catch (e) {
      onError(e instanceof Error ? e.message : "Assign failed");
    }
  }

  async function unassignUser(userId: string) {
    try {
      const res = await fetch("/api/admin/schemes/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schemeId: null, userIds: [userId] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "Unassign failed");
      onChange("User unassigned — they are blocked from transacting until a scheme is assigned.");
    } catch (e) {
      onError(e instanceof Error ? e.message : "Unassign failed");
    }
  }

  const unassigned = sdList.filter((u) => !assignedIds.has(u.id));

  return (
    <section className="overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-ink-100 bg-gradient-to-r from-violet-50 to-brand-50 px-5 py-3">
        <Users className="h-4 w-4 text-violet-600" />
        <h3 className="font-display text-sm font-semibold text-ink-900">Assignment</h3>
        <span className="ml-auto text-xs text-ink-400">
          Cascade model — admin assigns to super distributors only. Lower tiers receive derived schemes.
        </span>
      </div>

      <div className="grid gap-6 p-5 lg:grid-cols-2">
        {/* Available super distributors */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-widest text-ink-500">
              Super distributors ({unassigned.length} available)
            </p>
            {unassigned.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => setAssignAllConfirmOpen(true)} disabled={assigningAll}>
                {assigningAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />} Assign all
              </Button>
            )}
          </div>
          {loadingSd ? (
            <p className="py-4 text-center text-sm text-ink-400">Loading…</p>
          ) : unassigned.length === 0 ? (
            <p className="rounded-xl border border-dashed border-ink-200 px-3 py-6 text-center text-sm text-ink-500">
              All super distributors are assigned to this scheme.
            </p>
          ) : (
            <ul className="max-h-72 divide-y divide-ink-100 overflow-y-auto rounded-xl border border-ink-100">
              {unassigned.map((u) => (
                <li key={u.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink-900">{u.name}</span>
                    <span className="block truncate text-xs text-ink-500">{u.shopName ?? u.email}</span>
                  </span>
                  <button
                    onClick={() => assignUser(u.id)}
                    className="ml-2 shrink-0 text-xs font-semibold text-brand-700 hover:text-brand-800"
                  >
                    Assign
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Currently assigned */}
        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-ink-500">Currently assigned ({assigned.length})</p>
          {assigned.length === 0 ? (
            <p className="rounded-xl border border-dashed border-ink-200 px-3 py-6 text-center text-sm text-ink-500">
              No users assigned. Users without a scheme are blocked from transacting.
            </p>
          ) : (
            <ul className="max-h-72 divide-y divide-ink-100 overflow-y-auto rounded-xl border border-ink-100">
              {assigned.map((u) => (
                <li key={u.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink-900">{u.name}</span>
                    <span className="block truncate text-xs text-ink-500">{u.email}</span>
                  </span>
                  <button
                    onClick={() => unassignUser(u.id)}
                    className="ml-2 shrink-0 text-xs font-semibold text-rose-600 hover:text-rose-700"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={assignAllConfirmOpen}
        onClose={() => setAssignAllConfirmOpen(false)}
        busy={assigningAll}
        tone="default"
        title="Assign scheme to all super distributors?"
        description={
          <>
            This scheme will be assigned to <span className="font-semibold text-ink-900">ALL super distributors</span>, overriding their current scheme.
          </>
        }
        confirmLabel="Assign to all"
        onConfirm={async () => {
          await assignAll();
          setAssignAllConfirmOpen(false);
        }}
      />
    </section>
  );
}
