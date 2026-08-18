"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Button } from "@/components/ui/Button";
import { EmptyState, Panel, StatTile, StatusPill } from "@/components/dashboard/ui";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";
import {
  RefreshCw,
  DownloadCloud,
  Power,
  PowerOff,
  CreditCard,
  Monitor,
  Receipt,
  Landmark,
  QrCode,
  Send,
  Smartphone,
  Fingerprint,
  Plane,
  Boxes,
  type LucideIcon,
} from "lucide-react";

type ServiceRoute = {
  id: string;
  key: string;
  name: string;
  type: "SERVICE" | "CONFIG" | "SETTING";
  kind: string;
  provider: string | null;
  enabled: boolean;
  note: string | null;
  sortOrder: number;
  updatedAt: string;
};

type KindMeta = {
  label: string;
  icon: LucideIcon;
  /** Gradient used for the group header chip + active toggle. */
  gradient: string;
  ring: string;
};

const KIND_META: Record<string, KindMeta> = {
  PAYOUT: { label: "Payouts", icon: Landmark, gradient: "from-violet-500 to-brand-500", ring: "ring-violet-200" },
  PG: { label: "Payment Gateway", icon: CreditCard, gradient: "from-brand-500 to-sky-500", ring: "ring-brand-200" },
  POS: { label: "POS Terminals", icon: Monitor, gradient: "from-sky-500 to-cyan-500", ring: "ring-sky-200" },
  BBPS: { label: "Bill Payments", icon: Receipt, gradient: "from-amber-500 to-orange-500", ring: "ring-amber-200" },
  QR: { label: "QR Payments", icon: QrCode, gradient: "from-fuchsia-500 to-pink-500", ring: "ring-fuchsia-200" },
  UPI: { label: "UPI", icon: Send, gradient: "from-emerald-500 to-teal-500", ring: "ring-emerald-200" },
  RECHARGE: { label: "Recharges", icon: Smartphone, gradient: "from-rose-500 to-red-500", ring: "ring-rose-200" },
  AEPS: { label: "AePS / Aadhaar Pay", icon: Fingerprint, gradient: "from-indigo-500 to-blue-500", ring: "ring-indigo-200" },
  DMT: { label: "Money Transfer", icon: Send, gradient: "from-teal-500 to-emerald-500", ring: "ring-teal-200" },
  TRAVEL: { label: "Travel", icon: Plane, gradient: "from-cyan-500 to-blue-500", ring: "ring-cyan-200" },
  OTHER: { label: "Other", icon: Boxes, gradient: "from-ink-500 to-ink-700", ring: "ring-ink-200" },
};

function metaFor(kind: string): KindMeta {
  return KIND_META[kind] ?? KIND_META.OTHER;
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const sec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function AdminServicesPage() {
  const [services, setServices] = useState<ServiceRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const notify = useCallback((text: string, ok: boolean) => {
    if (ok) toast.success(text);
    else toast.error(text);
  }, []);

  const fetchServices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/services");
      const data = await res.json();
      if (Array.isArray(data.services)) setServices(data.services);
    } catch {
      notify("Failed to load services.", false);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    fetchServices();
  }, [fetchServices]);

  const toggle = useCallback(
    async (svc: ServiceRoute) => {
      const next = !svc.enabled;
      // Optimistic update.
      setServices((prev) =>
        prev.map((s) => (s.id === svc.id ? { ...s, enabled: next } : s))
      );
      setPending((p) => ({ ...p, [svc.id]: true }));
      try {
        const res = await fetch(`/api/admin/services/${svc.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: next }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "Update failed");
        // Reconcile with server truth (updatedAt etc.).
        setServices((prev) =>
          prev.map((s) => (s.id === svc.id ? { ...s, ...data.service } : s))
        );
        notify(`${svc.name} ${next ? "enabled" : "disabled"} — audit logged.`, true);
      } catch (e) {
        // Revert on failure.
        setServices((prev) =>
          prev.map((s) => (s.id === svc.id ? { ...s, enabled: svc.enabled } : s))
        );
        notify(e instanceof Error ? e.message : "Update failed", false);
      } finally {
        setPending((p) => {
          const { [svc.id]: _omit, ...rest } = p;
          return rest;
        });
      }
    },
    [notify]
  );

  const seedDefaults = useCallback(async () => {
    setSeeding(true);
    try {
      const res = await fetch("/api/admin/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "seed" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Seed failed");
      notify(`Seeded defaults: +${data.created} new, ${data.updated} refreshed.`, true);
      await fetchServices();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Seed failed", false);
    } finally {
      setSeeding(false);
    }
  }, [fetchServices, notify]);

  const grouped = useMemo(() => {
    const map = new Map<string, ServiceRoute[]>();
    for (const s of services) {
      const arr = map.get(s.kind) ?? [];
      arr.push(s);
      map.set(s.kind, arr);
    }
    return Array.from(map.entries()).sort((a, b) => {
      const sa = Math.min(...a[1].map((x) => x.sortOrder));
      const sb = Math.min(...b[1].map((x) => x.sortOrder));
      return sa - sb;
    });
  }, [services]);

  const enabledCount = services.filter((s) => s.enabled).length;

  return (
    <div className="space-y-6">
      <Reveal distance={14} duration={0.4}>
        <PageHeader
          eyebrow="Admin"
          title="On / Off Services"
          description="Master kill-switch for every money rail & platform flag. Turning a rail off blocks its mutations across the app immediately — every change is audit logged."
          actions={
            <>
              <Button variant="outline" onClick={fetchServices} disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
              </Button>
              <Button variant="outline" onClick={seedDefaults} disabled={seeding}>
                <DownloadCloud className={`h-4 w-4 ${seeding ? "animate-pulse" : ""}`} /> Seed defaults
              </Button>
            </>
          }
        />
      </Reveal>

      <Stagger stagger={0.05} className="grid gap-3 sm:grid-cols-3">
        <StaggerItem distance={14} duration={0.35}>
          <StatTile label="Total rails" countTo={services.length} icon={Boxes} tone="brand" loading={loading} />
        </StaggerItem>
        <StaggerItem distance={14} duration={0.35}>
          <StatTile label="Live" countTo={enabledCount} icon={Power} tone="emerald" loading={loading} />
        </StaggerItem>
        <StaggerItem distance={14} duration={0.35}>
          <StatTile
            label="Disabled"
            countTo={services.length - enabledCount}
            icon={PowerOff}
            tone="rose"
            loading={loading}
          />
        </StaggerItem>
      </Stagger>

      {loading ? (
        <Panel className="p-10 text-center text-sm text-ink-500">Loading services…</Panel>
      ) : services.length === 0 ? (
        <EmptyState
          icon={Power}
          title="No service routes yet"
          message="Seed the known rails to populate the panel."
          cta={
            <Button onClick={seedDefaults} disabled={seeding}>
              <DownloadCloud className="h-4 w-4" /> Seed defaults
            </Button>
          }
        />
      ) : (
        <Reveal distance={16} duration={0.45} className="space-y-8">
          {grouped.map(([kind, items]) => {
            const meta = metaFor(kind);
            const Icon = meta.icon;
            return (
              <section key={kind}>
                <div className="mb-3 flex items-center gap-3">
                  <span
                    className={`inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br ${meta.gradient} text-white shadow-soft`}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <div>
                    <h2 className="font-display text-base font-bold text-ink-900">{meta.label}</h2>
                    <p className="text-xs text-ink-500">
                      {items.filter((i) => i.enabled).length}/{items.length} live
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {items.map((svc) => (
                    <ServiceCard
                      key={svc.id}
                      svc={svc}
                      meta={meta}
                      busy={!!pending[svc.id]}
                      onToggle={() => toggle(svc)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </Reveal>
      )}
    </div>
  );
}

function ServiceCard({
  svc,
  meta,
  busy,
  onToggle,
}: {
  svc: ServiceRoute;
  meta: KindMeta;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border bg-white p-5 shadow-sm transition-all ${
        svc.enabled
          ? `border-transparent ring-2 ${meta.ring}`
          : "border-ink-100 opacity-90"
      }`}
    >
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${
          svc.enabled ? meta.gradient : "from-ink-200 to-ink-200"
        }`}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-display text-base font-semibold text-ink-900">{svc.name}</h3>
            <StatusPill status={svc.enabled ? "ON" : "OFF"} tone={svc.enabled ? "success" : "danger"} />
          </div>
          <p className="mt-0.5 font-mono text-[11px] text-ink-400">{svc.key}</p>
        </div>

        <Toggle on={svc.enabled} busy={busy} gradient={meta.gradient} onClick={onToggle} label={svc.name} />
      </div>

      {svc.note && <p className="mt-3 text-sm leading-relaxed text-ink-600">{svc.note}</p>}

      <div className="mt-4 flex items-center justify-between border-t border-ink-100 pt-3 text-xs text-ink-500">
        <span className="inline-flex items-center gap-1">
          <span className="font-semibold text-ink-700">Provider:</span>{" "}
          {svc.provider ?? "—"}
        </span>
        <span>Updated {timeAgo(svc.updatedAt)}</span>
      </div>
    </div>
  );
}

function Toggle({
  on,
  busy,
  gradient,
  onClick,
  label,
}: {
  on: boolean;
  busy: boolean;
  gradient: string;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`Toggle ${label}`}
      disabled={busy}
      onClick={onClick}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-60 ${
        on ? `bg-gradient-to-r ${gradient}` : "bg-ink-200"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 ${
          on ? "translate-x-6" : "translate-x-1"
        } ${busy ? "animate-pulse" : ""}`}
      />
    </button>
  );
}
