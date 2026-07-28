"use client";

/**
 * Scheme Management (unified) — every scheme is a single expandable card with
 * an icon strip: one colored icon per service family (BBPS, Payout) that opens
 * an "add slab" modal, plus a POS MDR icon that adds a merchant-discount-rate
 * row. One scheme prices charges, commission values, and POS settlement MDR.
 *
 * Flat model: admin assigns schemes directly to any user. Commission values
 * defined in the scheme are credited to the user on PG/POS/QR transactions.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input, Label, Select } from "@/components/ui/Input";
import { SERVICE_FAMILIES, familyOf, type ServiceFamily } from "@/lib/scheme/constants";
import {
  RefreshCw,
  Plus,
  Layers,
  Star,
  Users,
  ChevronDown,
  Loader2,
  X,
  Pencil,
  Trash2,
  Power,
  CreditCard,
  Send,
  Store,
  Settings2,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types (JSON shapes from the admin APIs)
// ---------------------------------------------------------------------------

type RateType = "FLAT" | "PERCENT";

type Scheme = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  isDefault: boolean;
  ownerId: string | null;
  slabCount: number;
  mdrSlabCount: number;
  userCount: number;
};

type Slab = {
  id: string;
  service: string;
  provider: string | null;
  minAmount: number;
  maxAmount: number;
  chargeType: RateType;
  chargeValue: number;
  chargeGstInclusive: boolean;
  active: boolean;
};

type MdrSlab = {
  id: string;
  serviceKind: string;
  paymentMode: string;
  company: string | null;
  cardType: string | null;
  brandType: string | null;
  classification: string | null;
  minAmount: number;
  maxAmount: number;
  mdrType: RateType;
  mdrValue: number;
  mdrValueT0: number;
  vendorCharge: number;
  vendorChargeT0: number;
  commissionType: RateType;
  commissionDistributor: number;
  commissionMaster: number;
  commissionSuperDistributor: number;
  commissionDistributorT0: number;
  commissionMasterT0: number;
  commissionSuperDistributorT0: number;
  active: boolean;
};

type AssignedUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

type BrandRate = {
  provider: string;
  paymentMode: string;
  cardType: string | null;
  brandType: string | null;
  classification: string | null;
  mdrType: string;
  mdrValue: number;
  mdrValueT0: number;
  minAmount: number;
  maxAmount: number;
};

type Meta = {
  providersByKind: Record<string, Array<{ provider: string; name: string }>>;
  posCompanies: string[];
  brandRatesByCompany: Record<string, BrandRate[]>;
  // PG/QR acquiring rate cards (the POS-brand analogue for the PG & QR rails).
  railProvidersByKind: Record<"PG" | "QR", Array<{ scopeKey: string; label: string }>>;
  railRatesByKind: Record<"PG" | "QR", Record<string, BrandRate[]>>;
  cardClassificationEnabled: boolean;
};

const EMPTY_RAIL_PROVIDERS: Meta["railProvidersByKind"] = { PG: [], QR: [] };
const EMPTY_RAIL_RATES: Meta["railRatesByKind"] = { PG: {}, QR: {} };

// ---------------------------------------------------------------------------
// Family icon strip config
// ---------------------------------------------------------------------------

const FAMILY_ICONS: Record<string, { icon: typeof CreditCard; className: string; hover: string }> = {
  BBPS: { icon: CreditCard, className: "text-blue-600", hover: "hover:bg-blue-50" },
  PAYOUT: { icon: Send, className: "text-cyan-600", hover: "hover:bg-cyan-50" },
};

const POS_ICON = { icon: Store, className: "text-orange-600", hover: "hover:bg-orange-50" };

const CARD_TYPES = ["CREDIT", "DEBIT", "PREPAID"];
const BRAND_TYPES = ["VISA", "MASTERCARD", "RUPAY", "AMEX", "DINERS"];
// Card tiers used to pin classification-specific MDR. Matching is tier-based
// (see canonicalCardLevel), so picking "PLATINUM" here matches feed/BIN labels
// like "VISA PLATINUM" or "PLATINUM MASTERCARD" too. Keep in sync with
// CARD_LEVELS in src/lib/pos/binLookup.ts.
const CLASSIFICATIONS = [
  "SIGNATURE",
  "INFINITE",
  "PLATINUM",
  "TITANIUM",
  "WORLD",
  "WORLD ELITE",
  "CORPORATE",
  "COMMERCIAL",
  "BUSINESS",
  "PURCHASE",
  "REWARDS",
  "PREMIUM",
  "GOLD",
  "CLASSIC",
  "STANDARD",
  "ELECTRON",
  "MAESTRO",
  "PREPAID",
];
const PAYMENT_MODES = ["*", "CARD", "UPI", "NFC", "BHARATQR"];

// Pick the most specific approved brand rate matching a slab's card dimensions.
// Mirrors the server resolver (brand/mdr.ts): a wildcard rate dimension is
// eligible but scores 0; a pinned mismatch is ineligible; highest score wins.
// Admin-entered values on both sides are canonical, so a plain uppercase
// compare is sufficient here (feed-label canonicalisation happens server-side).
function pickBrandRate(
  rates: BrandRate[] | undefined,
  dims: { paymentMode?: string | null; cardType?: string | null; brandType?: string | null; classification?: string | null }
): BrandRate | null {
  if (!rates || rates.length === 0) return null;
  const up = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();
  const wild = (v: string | null | undefined) => {
    const s = up(v);
    return s === "" || s === "*";
  };
  let best: BrandRate | null = null;
  let bestScore = -1;
  for (const r of rates) {
    const pairs: Array<[string | null, string | null | undefined]> = [
      [r.paymentMode, dims.paymentMode],
      [r.cardType, dims.cardType],
      [r.brandType, dims.brandType],
      [r.classification, dims.classification],
    ];
    let score = 0;
    let eligible = true;
    for (const [rv, tv] of pairs) {
      if (wild(rv)) continue;
      if (wild(tv) || up(rv) !== up(tv)) {
        eligible = false;
        break;
      }
      score++;
    }
    if (eligible && score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}

function fmtRate(type: RateType, value: number): string {
  if (value === 0) return "—";
  return type === "FLAT" ? `₹${value.toLocaleString("en-IN")}` : `${(value * 100).toFixed(2)}%`;
}

function fmtBand(min: number, max: number): string {
  return `₹${min.toLocaleString("en-IN")} – ₹${max.toLocaleString("en-IN")}`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SchemeManagementPage() {
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [meta, setMeta] = useState<Meta>({
    providersByKind: {},
    posCompanies: [],
    brandRatesByCompany: {},
    railProvidersByKind: EMPTY_RAIL_PROVIDERS,
    railRatesByKind: EMPTY_RAIL_RATES,
    cardClassificationEnabled: false,
  });
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "all">("active");
  const [createOpen, setCreateOpen] = useState(false);

  const notify = useCallback((text: string, ok: boolean) => {
    if (ok) toast.success(text);
    else toast.error(text);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, metaRes] = await Promise.all([
        fetch("/api/admin/schemes"),
        fetch("/api/admin/schemes/meta"),
      ]);
      const sData = await sRes.json();
      if (Array.isArray(sData.schemes)) setSchemes(sData.schemes);
      if (metaRes.ok) {
        const metaData = await metaRes.json();
        if (metaData.providersByKind)
          setMeta({
            providersByKind: metaData.providersByKind,
            posCompanies: metaData.posCompanies ?? [],
            brandRatesByCompany: metaData.brandRatesByCompany ?? {},
            railProvidersByKind: metaData.railProvidersByKind ?? EMPTY_RAIL_PROVIDERS,
            railRatesByKind: metaData.railRatesByKind ?? EMPTY_RAIL_RATES,
            cardClassificationEnabled: Boolean(metaData.cardClassificationEnabled),
          });
      } else {
        notify("Failed to load dropdown metadata", false);
      }
    } catch {
      notify("Failed to load schemes", false);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  const visibleSchemes = useMemo(
    () =>
      schemes.filter(
        (s) =>
          (statusFilter === "all" || s.active) &&
          (!query.trim() || s.name.toLowerCase().includes(query.trim().toLowerCase()))
      ),
    [schemes, query, statusFilter]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="Scheme Management"
        description="Create and manage schemes with charges, MDR rates, and commission values. Assign any scheme directly to any user. Commissions apply only to PG/POS/QR transactions."
        actions={
          <>
            <Button variant="outline" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> New scheme
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full max-w-xs">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search schemes…" />
        </div>
        <Select
          className="w-32"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "active" | "all")}
        >
          <option value="active">Active</option>
          <option value="all">All</option>
        </Select>
      </div>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-brand-600" />
          <h2 className="font-display text-sm font-semibold uppercase tracking-widest text-ink-600">
            Schemes ({visibleSchemes.length})
          </h2>
        </div>
        {loading && schemes.length === 0 ? (
          <div className="rounded-2xl border border-ink-100 bg-white p-10 text-center text-sm text-ink-500">
            Loading schemes…
          </div>
        ) : visibleSchemes.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-ink-200 bg-white p-10 text-center text-sm text-ink-500">
            No schemes found. Create one to configure charges and MDR.
          </div>
        ) : (
          <div className="space-y-3">
            {visibleSchemes.map((s) => (
              <SchemeCard key={s.id} scheme={s} meta={meta} notify={notify} onChanged={load} />
            ))}
          </div>
        )}
      </section>

      {createOpen && (
        <CreateSchemeModal
          onClose={() => setCreateOpen(false)}
          onSaved={(msg) => {
            setCreateOpen(false);
            notify(msg, true);
            load();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unified scheme card
// ---------------------------------------------------------------------------

function SchemeCard({
  scheme,
  meta,
  notify,
  onChanged,
}: {
  scheme: Scheme;
  meta: Meta;
  notify: (msg: string, ok: boolean) => void;
  onChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [slabs, setSlabs] = useState<Slab[] | null>(null);
  const [mdrSlabs, setMdrSlabs] = useState<MdrSlab[] | null>(null);
  const [assignedUsers, setAssignedUsers] = useState<AssignedUser[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [slabModal, setSlabModal] = useState<{ family: ServiceFamily; editing: Slab | null } | null>(null);
  const [mdrModal, setMdrModal] = useState<{ editing: MdrSlab | null } | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadDetail = useCallback(async () => {
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/admin/schemes/${scheme.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to load slabs");
      setSlabs(data.scheme.slabs ?? []);
      setMdrSlabs(data.scheme.mdrSlabs ?? []);
      setAssignedUsers(data.assignedUsers ?? []);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed to load slabs", false);
    } finally {
      setLoadingDetail(false);
    }
  }, [scheme.id, notify]);

  useEffect(() => {
    if (expanded && slabs === null) loadDetail();
  }, [expanded, slabs, loadDetail]);

  async function toggleActive() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/schemes/${scheme.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !scheme.active }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "Update failed");
      notify(scheme.active ? "Scheme deactivated." : "Scheme activated.", true);
      onChanged();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Update failed", false);
    } finally {
      setBusy(false);
    }
  }

  async function deleteScheme() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/schemes/${scheme.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "Delete failed");
      notify("Scheme deactivated.", true);
      onChanged();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Delete failed", false);
    } finally {
      setBusy(false);
      setDeleteOpen(false);
    }
  }

  async function deleteSlab(slab: Slab) {
    try {
      const res = await fetch(`/api/admin/schemes/${scheme.id}/slabs/${slab.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Delete failed");
      notify("Slab removed.", true);
      loadDetail();
      onChanged();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Delete failed", false);
    }
  }

  async function deleteMdrSlab(slab: MdrSlab) {
    try {
      const res = await fetch(`/api/admin/schemes/${scheme.id}/mdr-slabs`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slabId: slab.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Delete failed");
      notify("MDR rate removed.", true);
      loadDetail();
      onChanged();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Delete failed", false);
    }
  }

  // Group loaded service slabs by family for the expanded sections.
  const grouped = useMemo(() => {
    if (!slabs) return [];
    const map = new Map<string, Slab[]>();
    for (const s of slabs) {
      const fam = familyOf(s.service).key;
      const arr = map.get(fam) ?? [];
      arr.push(s);
      map.set(fam, arr);
    }
    return SERVICE_FAMILIES.filter((f) => map.has(f.key)).map(
      (f) =>
        [f, (map.get(f.key) ?? []).sort((a, b) => a.service.localeCompare(b.service) || a.minAmount - b.minAmount)] as const
    );
  }, [slabs]);

  return (
    <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-sm">
      {/* Card header */}
      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-sky-500 text-white">
          <Settings2 className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-display text-sm font-semibold text-ink-900">{scheme.name}</h3>
            {scheme.isDefault && (
              <Badge variant="accent">
                <Star className="h-3 w-3" /> Default
              </Badge>
            )}
            <Badge variant={scheme.active ? "success" : "danger"}>{scheme.active ? "active" : "inactive"}</Badge>
            <Badge variant="brand">{scheme.slabCount} slabs</Badge>
            <Badge variant="warning">{scheme.mdrSlabCount} MDR</Badge>
            <Badge variant="default">
              <Users className="h-3 w-3" /> {scheme.userCount} mapped
            </Badge>
            <Badge variant="default">{scheme.ownerId ? "Derived" : "Admin"}</Badge>
          </div>
          {scheme.description && <p className="mt-0.5 truncate text-xs text-ink-500">{scheme.description}</p>}
        </div>

        {/* Icon strip: BBPS / Payout slab modals + POS MDR + manage actions */}
        <div className="flex items-center gap-0.5">
          {SERVICE_FAMILIES.map((f) => {
            const cfg = FAMILY_ICONS[f.key];
            if (!cfg) return null;
            const Icon = cfg.icon;
            return (
              <button
                key={f.key}
                onClick={() => {
                  setSlabModal({ family: f, editing: null });
                  setExpanded(true);
                }}
                className={`grid h-8 w-8 place-items-center rounded-lg ${cfg.className} ${cfg.hover}`}
                title={`Add ${f.label} slab`}
              >
                <Icon className="h-4 w-4" />
              </button>
            );
          })}
          <button
            onClick={() => {
              setMdrModal({ editing: null });
              setExpanded(true);
            }}
            className={`grid h-8 w-8 place-items-center rounded-lg ${POS_ICON.className} ${POS_ICON.hover}`}
            title="Add POS MDR rate"
          >
            <Store className="h-4 w-4" />
          </button>
          <span className="mx-1 h-5 w-px bg-ink-100" />
          <button
            onClick={() => setAssignOpen(true)}
            className="grid h-8 w-8 place-items-center rounded-lg text-violet-600 hover:bg-violet-50"
            title="Assign to users"
          >
            <Users className="h-4 w-4" />
          </button>
          <button
            onClick={toggleActive}
            disabled={busy}
            className="grid h-8 w-8 place-items-center rounded-lg text-ink-500 hover:bg-ink-50 disabled:opacity-50"
            title={scheme.active ? "Deactivate" : "Activate"}
          >
            <Power className="h-4 w-4" />
          </button>
          <button
            onClick={() => setDeleteOpen(true)}
            disabled={busy}
            className="grid h-8 w-8 place-items-center rounded-lg text-rose-500 hover:bg-rose-50 disabled:opacity-50"
            title="Delete scheme"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="grid h-8 w-8 place-items-center rounded-lg text-ink-500 hover:bg-ink-50"
            title={expanded ? "Collapse" : "Expand"}
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {/* Expanded per-family slab sections + POS MDR */}
      {expanded && (
        <div className="space-y-4 border-t border-ink-100 bg-ink-50/30 px-5 py-4">
          {loadingDetail && slabs === null ? (
            <p className="py-4 text-center text-sm text-ink-500">Loading slabs…</p>
          ) : grouped.length === 0 && (!mdrSlabs || mdrSlabs.length === 0) ? (
            <p className="py-4 text-center text-sm text-ink-500">
              No slabs configured yet — use the icons above to add BBPS / Payout charges or a POS MDR rate.
            </p>
          ) : (
            <>
              {grouped.map(([family, list]) => {
                const cfg = FAMILY_ICONS[family.key];
                const Icon = cfg.icon;
                return (
                  <div key={family.key}>
                    <div className="mb-2 flex items-center gap-1.5">
                      <Icon className={`h-4 w-4 ${cfg.className}`} />
                      <h4 className={`text-sm font-semibold ${cfg.className}`}>
                        {family.label} ({list.length})
                      </h4>
                    </div>
                    <div className="overflow-x-auto rounded-xl border border-ink-100 bg-white">
                      <table className="w-full min-w-max text-sm">
                        <thead className="bg-ink-50/60 text-left text-[11px] uppercase tracking-wider text-ink-500">
                          <tr>
                            <th className="px-4 py-2 font-semibold">Service</th>
                            <th className="px-4 py-2 font-semibold">Provider</th>
                            <th className="px-4 py-2 font-semibold">Slab</th>
                            <th className="px-4 py-2 text-right font-semibold">Charge</th>
                            <th className="px-4 py-2 text-center font-semibold">Status</th>
                            <th className="px-4 py-2" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-ink-100 text-ink-800">
                          {list.map((s) => (
                            <tr key={s.id} className="hover:bg-brand-50/30">
                              <td className="px-4 py-2.5 font-medium">{s.service.replace(/_/g, " ")}</td>
                              <td className="px-4 py-2.5 text-xs">{s.provider ?? "All"}</td>
                              <td className="px-4 py-2.5">{fmtBand(s.minAmount, s.maxAmount)}</td>
                              <td className="px-4 py-2.5 text-right">
                                {fmtRate(s.chargeType, s.chargeValue)}
                                <span className={`ml-1.5 inline-block rounded px-1 py-0.5 text-[10px] font-semibold leading-none ${s.chargeGstInclusive ? "bg-amber-100 text-amber-700" : "bg-sky-100 text-sky-700"}`}>
                                  {s.chargeGstInclusive ? "incl. GST" : "+ GST"}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-center">
                                <Badge variant={s.active ? "success" : "danger"}>{s.active ? "On" : "Off"}</Badge>
                              </td>
                              <td className="px-4 py-2.5 text-right">
                                <div className="flex justify-end gap-1">
                                  <button
                                    onClick={() => setSlabModal({ family, editing: s })}
                                    className="grid h-7 w-7 place-items-center rounded-lg text-brand-600 hover:bg-brand-50"
                                    title="Edit slab"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    onClick={() => deleteSlab(s)}
                                    className="grid h-7 w-7 place-items-center rounded-lg text-rose-600 hover:bg-rose-50"
                                    title="Delete slab"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}

              {/* POS MDR rates */}
              {mdrSlabs && mdrSlabs.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center gap-1.5">
                    <Store className="h-4 w-4 text-orange-600" />
                    <h4 className="text-sm font-semibold text-orange-600">POS MDR ({mdrSlabs.length})</h4>
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-ink-100 bg-white">
                    <table className="w-full min-w-max text-sm">
                      <thead className="bg-ink-50/60 text-left text-[11px] uppercase tracking-wider text-ink-500">
                        <tr>
                          <th className="px-4 py-2 font-semibold">Company</th>
                          <th className="px-4 py-2 font-semibold">Mode</th>
                          <th className="px-4 py-2 font-semibold">Card</th>
                          <th className="px-4 py-2 font-semibold">Brand</th>
                          <th className="px-4 py-2 text-right font-semibold">Service (MDR)</th>
                          <th className="px-4 py-2 text-right font-semibold">Vendor</th>
                          <th className="px-4 py-2 text-right font-semibold">Margin</th>
                          <th className="px-4 py-2 text-right font-semibold">DIST</th>
                          <th className="px-4 py-2 text-right font-semibold">M.DIST</th>
                          <th className="px-4 py-2 text-right font-semibold">S.DIST</th>
                          <th className="px-4 py-2 text-center font-semibold">Status</th>
                          <th className="px-4 py-2" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-ink-100 text-ink-800">
                        {mdrSlabs.map((s) => (
                          <tr key={s.id} className="hover:bg-orange-50/30">
                            <td className="px-4 py-2.5 font-medium">{s.company ?? "All"}</td>
                            <td className="px-4 py-2.5">{s.paymentMode === "*" ? "Any" : s.paymentMode}</td>
                            <td className="px-4 py-2.5">{s.cardType ?? "Any"}</td>
                            <td className="px-4 py-2.5">{s.brandType ?? "Any"}</td>
                            <td className="px-4 py-2.5 text-right font-semibold">{fmtRate(s.mdrType, s.mdrValue)}</td>
                            <td className="px-4 py-2.5 text-right text-ink-500">{fmtRate(s.mdrType, s.vendorCharge)}</td>
                            <td className="px-4 py-2.5 text-right font-semibold text-emerald-600">
                              {fmtRate(s.mdrType, Math.max(0, s.mdrValue - s.vendorCharge))}
                            </td>
                            <td className="px-4 py-2.5 text-right">{fmtRate(s.commissionType, s.commissionDistributor)}</td>
                            <td className="px-4 py-2.5 text-right">{fmtRate(s.commissionType, s.commissionMaster)}</td>
                            <td className="px-4 py-2.5 text-right">{fmtRate(s.commissionType, s.commissionSuperDistributor)}</td>
                            <td className="px-4 py-2.5 text-center">
                              <Badge variant={s.active ? "success" : "danger"}>{s.active ? "On" : "Off"}</Badge>
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <div className="flex justify-end gap-1">
                                <button
                                  onClick={() => setMdrModal({ editing: s })}
                                  className="grid h-7 w-7 place-items-center rounded-lg text-brand-600 hover:bg-brand-50"
                                  title="Edit MDR rate"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  onClick={() => deleteMdrSlab(s)}
                                  className="grid h-7 w-7 place-items-center rounded-lg text-rose-600 hover:bg-rose-50"
                                  title="Delete MDR rate"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Assigned users */}
              {assignedUsers.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center gap-1.5">
                    <Users className="h-4 w-4 text-violet-600" />
                    <h4 className="text-sm font-semibold text-violet-600">
                      Assigned Users ({assignedUsers.length})
                    </h4>
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-ink-100 bg-white">
                    <table className="w-full min-w-max text-sm">
                      <thead className="bg-ink-50/60 text-left text-[11px] uppercase tracking-wider text-ink-500">
                        <tr>
                          <th className="px-4 py-2 font-semibold">Name</th>
                          <th className="px-4 py-2 font-semibold">Email</th>
                          <th className="px-4 py-2 font-semibold">Role</th>
                          <th className="px-4 py-2 font-semibold">User ID</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-ink-100 text-ink-800">
                        {assignedUsers.map((u) => (
                          <tr key={u.id} className="hover:bg-violet-50/30">
                            <td className="px-4 py-2.5 font-medium">{u.name}</td>
                            <td className="px-4 py-2.5 text-ink-600">{u.email}</td>
                            <td className="px-4 py-2.5">
                              <Badge variant="brand">{u.role.replace(/_/g, " ")}</Badge>
                            </td>
                            <td className="px-4 py-2.5 font-mono text-xs text-ink-400">{u.id}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {slabModal && (
        <SlabModal
          schemeId={scheme.id}
          family={slabModal.family}
          editing={slabModal.editing}
          providers={meta.providersByKind[slabModal.family.routeKind] ?? []}
          onClose={() => setSlabModal(null)}
          onSaved={(msg) => {
            setSlabModal(null);
            notify(msg, true);
            loadDetail();
            onChanged();
          }}
        />
      )}

      {mdrModal && (
        <MdrRateModal
          schemeId={scheme.id}
          editing={mdrModal.editing}
          companies={meta.posCompanies}
          brandRatesByCompany={meta.brandRatesByCompany}
          railProvidersByKind={meta.railProvidersByKind}
          railRatesByKind={meta.railRatesByKind}
          showClassification={meta.cardClassificationEnabled}
          onClose={() => setMdrModal(null)}
          onSaved={(msg) => {
            setMdrModal(null);
            notify(msg, true);
            loadDetail();
            onChanged();
          }}
        />
      )}

      {assignOpen && (
        <AssignModal
          schemeId={scheme.id}
          onClose={() => setAssignOpen(false)}
          onChanged={(msg) => {
            notify(msg, true);
            onChanged();
          }}
          onError={(msg) => notify(msg, false)}
        />
      )}

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        busy={busy}
        tone="danger"
        title={`Delete scheme "${scheme.name}"?`}
        description="The scheme is deactivated (soft delete). Users must be unassigned first."
        confirmLabel="Delete"
        onConfirm={deleteScheme}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Slab modal (scoped to a service family, with provider dropdown) — charge only
// ---------------------------------------------------------------------------

function SlabModal({
  schemeId,
  family,
  editing,
  providers,
  onClose,
  onSaved,
}: {
  schemeId: string;
  family: ServiceFamily;
  editing: Slab | null;
  providers: Array<{ provider: string; name: string }>;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const isEdit = !!editing;
  const [service, setService] = useState<string>(
    editing?.service ?? (family.key === "PAYOUT" ? "ALL" : "ALL")
  );
  const [provider, setProvider] = useState<string>(editing?.provider ?? "");
  const [minAmount, setMinAmount] = useState(String(editing?.minAmount ?? 0));
  const [maxAmount, setMaxAmount] = useState(String(editing?.maxAmount ?? 100000));
  const [chargeType, setChargeType] = useState<RateType>(editing?.chargeType ?? "FLAT");
  // PERCENT edited as human percent (0.5 = 0.5%), stored as fraction (0.005).
  const [chargeValue, setChargeValue] = useState(
    String(editing ? (editing.chargeType === "PERCENT" ? editing.chargeValue * 100 : editing.chargeValue) : 0)
  );
  const [chargeGstInclusive, setChargeGstInclusive] = useState(editing?.chargeGstInclusive ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cfg = FAMILY_ICONS[family.key];
  const Icon = cfg.icon;

  function toStored(type: RateType, raw: string): number {
    const n = Number(raw);
    if (!isFinite(n) || n < 0) return 0;
    return type === "PERCENT" ? n / 100 : n;
  }

  async function submit() {
    setError(null);
    const min = Number(minAmount);
    const max = Number(maxAmount);
    if (!isFinite(min) || !isFinite(max) || min < 0 || max < min) {
      setError("Enter a valid amount range.");
      return;
    }
    setSaving(true);

    const base = {
      provider: provider || null,
      minAmount: min,
      maxAmount: max,
      chargeType,
      chargeValue: toStored(chargeType, chargeValue),
      chargeGstInclusive,
    };

    try {
      if (isEdit) {
        const res = await fetch(`/api/admin/schemes/${schemeId}/slabs/${editing!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(base),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "Save failed");
        onSaved("Slab updated.");
      } else {
        const services = service === "ALL" ? [...family.services] : [service];
        let created = 0;
        for (const svc of services) {
          const res = await fetch(`/api/admin/schemes/${schemeId}/slabs`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...base, service: svc }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : `Save failed for ${svc}`);
          created++;
        }
        onSaved(created > 1 ? `${created} slabs added for all ${family.label} services.` : "Slab added.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-900/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-ink-100 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-ink-100 bg-white px-5 py-4">
          <h3 className="flex items-center gap-2 font-display text-base font-semibold text-ink-900">
            <Icon className={`h-5 w-5 ${cfg.className}`} />
            {isEdit ? `Edit ${family.label} slab` : `Add ${family.label} slab`}
          </h3>
          <button onClick={onClose} className="rounded-lg p-1 text-ink-500 hover:bg-ink-50">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Service</Label>
              {family.key === "PAYOUT" ? (
                <>
                  <Input value="Payout" disabled />
                  <input type="hidden" value="ALL" />
                </>
              ) : (
                <Select value={service} onChange={(e) => setService(e.target.value)} disabled={isEdit}>
                  <option value="ALL">All Services</option>
                  {family.services.map((c) => (
                    <option key={c} value={c}>
                      {c.replace(/_/g, " ")}
                    </option>
                  ))}
                </Select>
              )}
            </div>
            <div>
              <Label>Provider</Label>
              <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
                <option value="">All providers</option>
                {providers.map((p) => (
                  <option key={p.provider} value={p.provider}>
                    {p.name}
                  </option>
                ))}
                {/* Keep an unknown/legacy provider selectable while editing */}
                {editing?.provider && !providers.some((p) => p.provider === editing.provider) && (
                  <option value={editing.provider}>{editing.provider}</option>
                )}
              </Select>
              <p className="mt-1 text-xs text-ink-400">
                A provider-specific slab wins over &quot;All providers&quot; for the same band.
              </p>
            </div>
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
              <Select value={chargeType} onChange={(e) => setChargeType(e.target.value as RateType)}>
                <option value="FLAT">Flat (₹)</option>
                <option value="PERCENT">Percent (%)</option>
              </Select>
              <Input type="number" min={0} step="0.0001" value={chargeValue} onChange={(e) => setChargeValue(e.target.value)} />
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
          </div>
          <p className="text-xs text-ink-400">
            Admin schemes set the charge only. Commission is added by each network parent when they derive a scheme
            for their children (cascade model). Percent values are entered as human percent (0.5 = 0.5%).
          </p>
        </div>
        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-ink-100 bg-white px-5 py-4">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Save configuration
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// POS MDR rate modal (company/card dimensions + T+1/T+0)
// ---------------------------------------------------------------------------

function MdrRateModal({
  schemeId,
  editing,
  companies,
  brandRatesByCompany,
  railProvidersByKind,
  railRatesByKind,
  showClassification,
  onClose,
  onSaved,
}: {
  schemeId: string;
  editing: MdrSlab | null;
  companies: string[];
  brandRatesByCompany: Record<string, BrandRate[]>;
  railProvidersByKind: Record<"PG" | "QR", Array<{ scopeKey: string; label: string }>>;
  railRatesByKind: Record<"PG" | "QR", Record<string, BrandRate[]>>;
  showClassification: boolean;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const isEdit = !!editing;
  const [serviceKind, setServiceKind] = useState(editing?.serviceKind ?? "POS");
  const [company, setCompany] = useState(editing?.company ?? "");
  const [paymentMode, setPaymentMode] = useState(editing?.paymentMode ?? "CARD");
  const [cardType, setCardType] = useState(editing?.cardType ?? "");
  const [brandType, setBrandType] = useState(editing?.brandType ?? "");
  const [classification, setClassification] = useState(editing?.classification ?? "");
  const [mdrType, setMdrType] = useState<RateType>(editing?.mdrType ?? "PERCENT");
  // PERCENT edited as human percent (1 = 1%), stored as fraction (0.01).
  const [mdrT1, setMdrT1] = useState(
    String(editing ? (editing.mdrType === "PERCENT" ? editing.mdrValue * 100 : editing.mdrValue) : 0)
  );
  const [mdrT0, setMdrT0] = useState(
    String(editing ? (editing.mdrType === "PERCENT" ? editing.mdrValueT0 * 100 : editing.mdrValueT0) : 0)
  );
  const [vendorT1, setVendorT1] = useState(
    String(editing ? (editing.mdrType === "PERCENT" ? editing.vendorCharge * 100 : editing.vendorCharge) : 0)
  );
  const [vendorT0, setVendorT0] = useState(
    String(editing ? (editing.mdrType === "PERCENT" ? editing.vendorChargeT0 * 100 : editing.vendorChargeT0) : 0)
  );
  const [commissionType, setCommissionType] = useState<RateType>(editing?.commissionType ?? "PERCENT");
  const [commDist, setCommDist] = useState(
    String(editing ? (editing.commissionType === "PERCENT" ? editing.commissionDistributor * 100 : editing.commissionDistributor) : 0)
  );
  const [commMaster, setCommMaster] = useState(
    String(editing ? (editing.commissionType === "PERCENT" ? editing.commissionMaster * 100 : editing.commissionMaster) : 0)
  );
  const [commSuper, setCommSuper] = useState(
    String(editing ? (editing.commissionType === "PERCENT" ? editing.commissionSuperDistributor * 100 : editing.commissionSuperDistributor) : 0)
  );
  // Instant (T+0) commission per tier — 0 means "use the T+1 value".
  const [commDistT0, setCommDistT0] = useState(
    String(editing ? (editing.commissionType === "PERCENT" ? editing.commissionDistributorT0 * 100 : editing.commissionDistributorT0) : 0)
  );
  const [commMasterT0, setCommMasterT0] = useState(
    String(editing ? (editing.commissionType === "PERCENT" ? editing.commissionMasterT0 * 100 : editing.commissionMasterT0) : 0)
  );
  const [commSuperT0, setCommSuperT0] = useState(
    String(editing ? (editing.commissionType === "PERCENT" ? editing.commissionSuperDistributorT0 * 100 : editing.commissionSuperDistributorT0) : 0)
  );
  const [applyScope, setApplyScope] = useState<"single" | "global">("single");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // POS / PG / QR vendor cost is LOCKED to the approved acquirer rate card —
  // never typed by hand — so the MDR can't be priced below cost. `locked` means
  // an approved rate was found and vendor is derived from it; `missing` means a
  // locked rail is selected without a resolvable approved rate (slab is blocked).
  // POS scopes by acquiring company (brand); PG/QR scope by the rail provider.
  const [posLock, setPosLock] = useState<{ locked: boolean; missing: boolean }>({
    locked: false,
    missing: false,
  });

  // Rails whose vendor cost is locked to an approved rate card.
  const isLockedRail = serviceKind === "POS" || serviceKind === "PG" || serviceKind === "QR";
  const scopeNoun = serviceKind === "POS" ? "company" : serviceKind === "PG" ? "PG pipeline" : "QR provider";

  // Resolve the rate card for the currently selected scope, per rail.
  const ratesForScope = useCallback(
    (scope: string): BrandRate[] | undefined => {
      if (serviceKind === "POS") return brandRatesByCompany[scope];
      if (serviceKind === "PG") return railRatesByKind.PG?.[scope];
      if (serviceKind === "QR") return railRatesByKind.QR?.[scope];
      return undefined;
    },
    [serviceKind, brandRatesByCompany, railRatesByKind]
  );

  useEffect(() => {
    if (!isLockedRail) {
      setPosLock({ locked: false, missing: false });
      return;
    }
    const co = company.trim();
    if (!co) {
      setPosLock({ locked: false, missing: true });
      return;
    }
    // Pick the most specific approved rate matching the slab's card dimensions
    // (instrument / network / classification), mirroring the server resolver.
    // When classification is disabled platform-wide it's treated as a wildcard.
    const pick = pickBrandRate(ratesForScope(co), {
      paymentMode,
      cardType,
      brandType,
      classification: showClassification ? classification : "",
    });
    if (!pick) {
      setPosLock({ locked: false, missing: true });
      return;
    }
    const isPercent = pick.mdrType === "PERCENT";
    setMdrType(pick.mdrType as RateType);
    setVendorT1(String(isPercent ? Number(pick.mdrValue) * 100 : Number(pick.mdrValue)));
    setVendorT0(String(isPercent ? Number(pick.mdrValueT0) * 100 : Number(pick.mdrValueT0)));
    setPosLock({ locked: true, missing: false });
  }, [isLockedRail, serviceKind, company, paymentMode, cardType, brandType, classification, showClassification, ratesForScope]);

  // A locked rail can only be scoped to an entity that already has an approved
  // rate card. POS → acquiring companies with brand rates; PG/QR → providers
  // with rail rates. Other rails (UPI) keep the full company list (optional).
  const lockedScopeOptions: Array<{ value: string; label: string }> =
    serviceKind === "POS"
      ? companies.filter((c) => (brandRatesByCompany[c]?.length ?? 0) > 0).map((c) => ({ value: c, label: c }))
      : serviceKind === "PG"
      ? railProvidersByKind.PG.map((p) => ({ value: p.scopeKey, label: p.label }))
      : serviceKind === "QR"
      ? railProvidersByKind.QR.map((p) => ({ value: p.scopeKey, label: p.label }))
      : companies.map((c) => ({ value: c, label: c }));

  // When the rail switches while a scope without an approved rate is selected,
  // clear it (the option is no longer available). Keep the slab being edited so
  // its existing scope stays visible.
  useEffect(() => {
    if (!isLockedRail) return;
    if (company && company !== editing?.company && !(ratesForScope(company)?.length ?? 0)) {
      setCompany("");
    }
  }, [isLockedRail, company, ratesForScope, editing?.company]);

  function toStored(type: RateType, raw: string): number {
    const n = Number(raw);
    if (!isFinite(n) || n < 0) return 0;
    return type === "PERCENT" ? n / 100 : n;
  }

  async function submit() {
    setError(null);
    setSaving(true);

    const dims = {
      paymentMode,
      company: company || null,
      cardType: cardType || null,
      brandType: brandType || null,
      classification: showClassification ? classification || null : null,
      mdrType,
      mdrValue: toStored(mdrType, mdrT1),
      mdrValueT0: toStored(mdrType, mdrT0),
      vendorCharge: toStored(mdrType, vendorT1),
      vendorChargeT0: toStored(mdrType, vendorT0),
      commissionType,
      commissionDistributor: toStored(commissionType, commDist),
      commissionMaster: toStored(commissionType, commMaster),
      commissionSuperDistributor: toStored(commissionType, commSuper),
      commissionDistributorT0: toStored(commissionType, commDistT0),
      commissionMasterT0: toStored(commissionType, commMasterT0),
      commissionSuperDistributorT0: toStored(commissionType, commSuperT0),
    };

    try {
      const res = await fetch(`/api/admin/schemes/${schemeId}/mdr-slabs`, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isEdit
            ? { slabId: editing!.id, ...dims }
            : { serviceKind, ...dims, global: applyScope === "global" }
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "Save failed");
      if (applyScope === "global" && data.created) {
        const msg = data.skipped > 0
          ? `MDR rate added to ${data.created} scheme(s). ${data.skipped} skipped (overlap).`
          : `MDR rate added to all ${data.created} scheme(s).`;
        onSaved(msg);
      } else {
        onSaved(isEdit ? "MDR rate updated." : "MDR rate added.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  // Live guardrail: the service charge (MDR) can never be set below the vendor
  // cost — that would mean the company pays the acquirer more than it collects
  // per transaction (a loss). This mirrors the server rule (no rate below MDR)
  // and the T+0 fallback (an unset T+0 rate uses the T+1 value).
  const numOf = (s: string) => {
    const n = Number(s);
    return isFinite(n) && n >= 0 ? n : 0;
  };
  const svcT1Val = numOf(mdrT1);
  const svcT0Val = numOf(mdrT0) > 0 ? numOf(mdrT0) : svcT1Val;
  const venT1Val = numOf(vendorT1);
  const venT0Val = numOf(vendorT0) > 0 ? numOf(vendorT0) : venT1Val;
  const COST_EPS = 1e-9;
  const belowCostT1 = venT1Val - svcT1Val > COST_EPS;
  const belowCostT0 = venT0Val - svcT0Val > COST_EPS;
  const belowCost = (venT1Val > 0 || venT0Val > 0) && (belowCostT1 || belowCostT0);
  const rateUnit = (v: number) => (mdrType === "PERCENT" ? `${v.toFixed(2)}%` : `₹${v.toFixed(2)}`);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-900/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-ink-100 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-ink-100 bg-white px-5 py-4">
          <h3 className="flex items-center gap-2 font-display text-base font-semibold text-ink-900">
            <Store className="h-5 w-5 text-orange-600" />
            {isEdit ? "Edit POS MDR rate" : "Add POS MDR rate"}
          </h3>
          <button onClick={onClose} className="rounded-lg p-1 text-ink-500 hover:bg-ink-50">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

          {!isEdit && (
            <div className="flex items-center gap-3 rounded-xl border border-ink-100 bg-ink-50/50 px-3 py-2.5">
              <span className="text-xs font-semibold uppercase tracking-widest text-ink-500">Apply to</span>
              <button
                type="button"
                onClick={() => setApplyScope("single")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  applyScope === "single"
                    ? "bg-ink-900 text-white shadow-sm"
                    : "text-ink-500 hover:bg-ink-100"
                }`}
              >
                This scheme
              </button>
              <button
                type="button"
                onClick={() => setApplyScope("global")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  applyScope === "global"
                    ? "bg-orange-600 text-white shadow-sm"
                    : "text-ink-500 hover:bg-ink-100"
                }`}
              >
                All schemes
              </button>
              {applyScope === "global" && (
                <span className="ml-auto text-xs text-orange-600">
                  This configuration will be applied to every active scheme
                </span>
              )}
            </div>
          )}

          <div>
            <Label>Rail</Label>
            <Select value={serviceKind} onChange={(e) => setServiceKind(e.target.value)} disabled={isEdit}>
              <option value="POS">POS</option>
              <option value="PG">Payment Gateway (PG)</option>
              <option value="QR">QR</option>
              <option value="UPI">UPI</option>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{serviceKind === "POS" ? "Company" : isLockedRail ? "Provider" : "Company"}</Label>
              <Select
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                disabled={isLockedRail && lockedScopeOptions.length === 0}
              >
                <option value="">
                  {serviceKind === "POS"
                    ? "Select a company…"
                    : isLockedRail
                    ? `Select a ${scopeNoun}…`
                    : "All Companies"}
                </option>
                {lockedScopeOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
                {editing?.company && !lockedScopeOptions.some((o) => o.value === editing.company) && (
                  <option value={editing.company}>{editing.company}</option>
                )}
              </Select>
              {isLockedRail && lockedScopeOptions.length === 0 && (
                <p className="mt-1 text-[11px] text-rose-600">
                  No {scopeNoun} has approved {serviceKind} rates yet. Define them in MDR &amp; minimum charges first.
                </p>
              )}
            </div>
            <div>
              <Label>Mode</Label>
              <Select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}>
                {PAYMENT_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m === "*" ? "Any" : m}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Card type</Label>
              <Select value={cardType} onChange={(e) => setCardType(e.target.value)}>
                <option value="">Any</option>
                {CARD_TYPES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Brand</Label>
              <Select value={brandType} onChange={(e) => setBrandType(e.target.value)}>
                <option value="">Any</option>
                {BRAND_TYPES.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
                {editing?.brandType && !BRAND_TYPES.includes(editing.brandType) && (
                  <option value={editing.brandType}>{editing.brandType}</option>
                )}
              </Select>
            </div>
            {showClassification && (
              <div>
                <Label>Classification</Label>
                <Select value={classification} onChange={(e) => setClassification(e.target.value)}>
                  <option value="">Any</option>
                  {CLASSIFICATIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                  {editing?.classification && !CLASSIFICATIONS.includes(editing.classification) && (
                    <option value={editing.classification}>{editing.classification}</option>
                  )}
                </Select>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-orange-100 bg-orange-50/40 p-3">
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-ink-500">Service charge & vendor cost</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Type</Label>
                <Select value={mdrType} onChange={(e) => setMdrType(e.target.value as RateType)}>
                  <option value="PERCENT">Percent (%)</option>
                  <option value="FLAT">Flat (₹)</option>
                </Select>
              </div>
              <div>
                <Label>{mdrType === "PERCENT" ? "Service T+1 (%)" : "Service T+1 (₹)"}</Label>
                <Input type="number" min={0} step="0.0001" value={mdrT1} onChange={(e) => setMdrT1(e.target.value)} />
              </div>
              <div>
                <Label>{mdrType === "PERCENT" ? "Service T+0 (%)" : "Service T+0 (₹)"}</Label>
                <Input type="number" min={0} step="0.0001" value={mdrT0} onChange={(e) => setMdrT0(e.target.value)} />
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <div />
              <div>
                <Label>{mdrType === "PERCENT" ? "Vendor T+1 (%)" : "Vendor T+1 (₹)"}</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.0001"
                  value={vendorT1}
                  onChange={(e) => setVendorT1(e.target.value)}
                  readOnly={posLock.locked}
                  className={posLock.locked ? "cursor-not-allowed bg-ink-50 text-ink-500" : undefined}
                />
              </div>
              <div>
                <Label>{mdrType === "PERCENT" ? "Vendor T+0 (%)" : "Vendor T+0 (₹)"}</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.0001"
                  value={vendorT0}
                  onChange={(e) => setVendorT0(e.target.value)}
                  readOnly={posLock.locked}
                  className={posLock.locked ? "cursor-not-allowed bg-ink-50 text-ink-500" : undefined}
                />
              </div>
            </div>
            <p className="mt-2 text-xs text-ink-500">
              The service charge (MDR) is deducted from the gross before crediting the retailer. The vendor charge
              is the acquirer cost the company pays upstream. Company revenue per txn = service − vendor, credited to
              the Revenue Wallet. T+0 applies to instant settlement; leave 0 to use the T+1 rate.
            </p>
            {posLock.locked && (
              <p className="mt-2 rounded-lg bg-brand-50/60 p-2 text-[11px] text-brand-700">
                Vendor cost is locked to the approved {serviceKind} rate for{" "}
                <span className="font-semibold">{company}</span>. The service charge (MDR) cannot be set below it.
              </p>
            )}
            {belowCost && (
              <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700">
                <span className="font-semibold">Rate too low — not allowed.</span> The service charge (MDR) can
                never be set below the vendor cost of{" "}
                {belowCostT1 && <span className="font-semibold">{rateUnit(venT1Val)} (T+1)</span>}
                {belowCostT1 && belowCostT0 && " and "}
                {belowCostT0 && <span className="font-semibold">{rateUnit(venT0Val)} (T+0)</span>}. Doing so means the
                company pays the acquirer more than it collects on every transaction (a guaranteed loss), so no
                retailer can be given a rate below MDR. Raise the service charge to at least the vendor cost.
              </p>
            )}
            {isLockedRail && posLock.missing && (
              <p className="mt-2 rounded-lg bg-rose-50 p-2 text-[11px] text-rose-600">
                {company
                  ? `No approved ${serviceKind} rate exists for ${company}${paymentMode ? ` (${paymentMode})` : ""}. Add it in MDR & minimum charges first.`
                  : `Select a ${scopeNoun}. ${serviceKind} MDR must be scoped to a ${scopeNoun} with an approved rate.`}
              </p>
            )}
          </div>

          <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-3">
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-ink-500">Commission (from Revenue Wallet)</p>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <Label>Type</Label>
                <Select value={commissionType} onChange={(e) => setCommissionType(e.target.value as RateType)}>
                  <option value="PERCENT">Percent (%)</option>
                  <option value="FLAT">Flat (₹)</option>
                </Select>
              </div>
              <div>
                <Label>DIST (T+1)</Label>
                <Input type="number" min={0} step="0.0001" value={commDist} onChange={(e) => setCommDist(e.target.value)} />
              </div>
              <div>
                <Label>M.DIST (T+1)</Label>
                <Input type="number" min={0} step="0.0001" value={commMaster} onChange={(e) => setCommMaster(e.target.value)} />
              </div>
              <div>
                <Label>S.DIST (T+1)</Label>
                <Input type="number" min={0} step="0.0001" value={commSuper} onChange={(e) => setCommSuper(e.target.value)} />
              </div>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-3">
              <div className="flex items-end pb-2 text-[11px] font-semibold uppercase tracking-widest text-ink-400">
                Instant (T+0)
              </div>
              <div>
                <Label>DIST (T+0)</Label>
                <Input type="number" min={0} step="0.0001" value={commDistT0} onChange={(e) => setCommDistT0(e.target.value)} />
              </div>
              <div>
                <Label>M.DIST (T+0)</Label>
                <Input type="number" min={0} step="0.0001" value={commMasterT0} onChange={(e) => setCommMasterT0(e.target.value)} />
              </div>
              <div>
                <Label>S.DIST (T+0)</Label>
                <Input type="number" min={0} step="0.0001" value={commSuperT0} onChange={(e) => setCommSuperT0(e.target.value)} />
              </div>
            </div>
            <p className="mt-2 text-xs text-ink-500">
              Commission paid up the chain per transaction — DIST → distributor, M.DIST → master distributor,
              S.DIST → super distributor. Paid out of the Revenue Wallet, net of 2% TDS. Total must not exceed the
              company margin (service − vendor). The transacting retailer earns no commission. The T+1 row applies
              to standard settlement; the T+0 (instant) row applies to instant settlement and falls back to the
              matching T+1 value when left 0.
            </p>
          </div>
        </div>
        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-ink-100 bg-white px-5 py-4">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || (isLockedRail && posLock.missing) || belowCost}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Save configuration
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assign modal — assign scheme to a role level or search a specific user
// ---------------------------------------------------------------------------

function AssignModal({
  schemeId,
  onClose,
  onChanged,
  onError,
}: {
  schemeId: string;
  onClose: () => void;
  onChanged: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [assigning, setAssigning] = useState(false);
  const [userList, setUserList] = useState<{ id: string; userCode: string | null; name: string; email: string; role: string; shopName: string | null }[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [assigned, setAssigned] = useState<{ id: string; name: string; email: string; role: string }[]>([]);
  const [loadingAssigned, setLoadingAssigned] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const assignedIds = useMemo(() => new Set(assigned.map((u) => u.id)), [assigned]);

  const loadData = useCallback(async () => {
    setLoadingAssigned(true);
    setLoadingUsers(true);
    try {
      const [schemeRes, usersRes] = await Promise.all([
        fetch(`/api/admin/schemes/${schemeId}`),
        fetch("/api/admin/users?pageSize=500"),
      ]);
      const schemeData = await schemeRes.json();
      const usersData = await usersRes.json();
      if (schemeRes.ok) setAssigned(schemeData.assignedUsers ?? []);
      if (usersRes.ok)
        setUserList(
          (usersData.users ?? []).map((u: { id: string; userCode: string | null; name: string; email: string; role: string; shopName: string | null }) => ({
            id: u.id,
            userCode: u.userCode,
            name: u.name,
            email: u.email,
            role: u.role,
            shopName: u.shopName,
          }))
        );
    } catch {
      /* silent */
    } finally {
      setLoadingAssigned(false);
      setLoadingUsers(false);
    }
  }, [schemeId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function assignAll() {
    setAssigning(true);
    try {
      const ids = unassigned.map((u) => u.id);
      if (ids.length === 0) return;
      const res = await fetch("/api/admin/schemes/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schemeId, userIds: ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "Assign failed");
      onChanged(`Assigned to ${data.updated} user(s).`);
      loadData();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Assign failed");
    } finally {
      setAssigning(false);
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
      onChanged("User assigned to scheme.");
      loadData();
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
      onChanged("User removed from scheme.");
      loadData();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Unassign failed");
    }
  }

  const unassigned = useMemo(() => {
    const list = userList.filter((u) => !assignedIds.has(u.id));
    if (!searchQuery.trim()) return list;
    const q = searchQuery.trim().toLowerCase();
    return list.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (u.shopName ?? "").toLowerCase().includes(q));
  }, [userList, assignedIds, searchQuery]);

  const ROLE_BADGE: Record<string, string> = {
    RETAILER: "RT",
    DISTRIBUTOR: "DT",
    MASTER_DISTRIBUTOR: "MD",
    SUPER_DISTRIBUTOR: "SD",
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-900/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-ink-100 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-ink-100 bg-white px-5 py-4">
          <h3 className="flex items-center gap-2 font-display text-base font-semibold text-ink-900">
            <Users className="h-5 w-5 text-violet-600" /> Assign scheme
          </h3>
          <button onClick={onClose} className="rounded-lg p-1 text-ink-500 hover:bg-ink-50">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <p className="text-xs text-ink-400">
            Assign this scheme to any user. The user will receive the charges and commission defined in this scheme.
          </p>

          <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search users…" />

          {/* Available users */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-widest text-ink-500">
                Available users ({unassigned.length})
              </p>
              {unassigned.length > 0 && unassigned.length <= 100 && (
                <Button size="sm" onClick={assignAll} disabled={assigning}>
                  {assigning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />} Assign all
                </Button>
              )}
            </div>
            {loadingUsers ? (
              <p className="py-4 text-center text-sm text-ink-400">Loading…</p>
            ) : unassigned.length === 0 ? (
              <p className="rounded-xl border border-dashed border-ink-200 px-3 py-4 text-center text-sm text-ink-500">
                All users are assigned to this scheme.
              </p>
            ) : (
              <ul className="max-h-48 divide-y divide-ink-100 overflow-y-auto rounded-xl border border-ink-100">
                {unassigned.slice(0, 100).map((u) => (
                  <li key={u.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink-900">
                        {u.name}
                        {u.userCode && <span className="ml-1.5 font-medium text-brand-600">{u.userCode}</span>}
                        <span className="ml-1.5 inline-block rounded bg-ink-100 px-1 py-0.5 text-[10px] font-semibold text-ink-600">{ROLE_BADGE[u.role] ?? u.role}</span>
                      </span>
                      <span className="block truncate text-xs text-ink-400">{u.shopName ?? u.email}</span>
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
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-ink-500">
              Currently assigned ({assigned.length})
            </p>
            {loadingAssigned ? (
              <p className="py-4 text-center text-sm text-ink-400">Loading…</p>
            ) : assigned.length === 0 ? (
              <p className="rounded-xl border border-dashed border-ink-200 px-3 py-4 text-center text-sm text-ink-500">
                No users assigned yet.
              </p>
            ) : (
              <ul className="max-h-48 divide-y divide-ink-100 overflow-y-auto rounded-xl border border-ink-100">
                {assigned.map((u) => (
                  <li key={u.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink-900">
                        {u.name}
                        <span className="ml-1.5 inline-block rounded bg-ink-100 px-1 py-0.5 text-[10px] font-semibold text-ink-600">{ROLE_BADGE[u.role] ?? u.role}</span>
                      </span>
                      <span className="block truncate text-xs text-ink-400">{u.email}</span>
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
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create scheme modal
// ---------------------------------------------------------------------------

function CreateSchemeModal({ onClose, onSaved }: { onClose: () => void; onSaved: (msg: string) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (name.trim().length < 2) {
      setError("Enter a scheme name (min 2 characters).");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/admin/schemes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "Create failed");
      onSaved("Scheme created — add BBPS / Payout charges and POS MDR via the icons.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-900/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-ink-100 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
          <h3 className="font-display text-base font-semibold text-ink-900">Create scheme</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-ink-500 hover:bg-ink-50">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Gold Super-Distributor Plan" />
          </div>
          <div>
            <Label>Description (optional)</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short note" />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-ink-100 px-5 py-4">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create
          </Button>
        </div>
      </div>
    </div>
  );
}
