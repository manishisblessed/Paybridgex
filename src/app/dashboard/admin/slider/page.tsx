"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input, Label, Select } from "@/components/ui/Input";
import { Panel, StatusPill, EmptyState } from "@/components/dashboard/ui";
import { Reveal } from "@/components/motion";
import {
  RefreshCw,
  Plus,
  Images,
  MonitorSmartphone,
  Upload,
  Loader2,
  Pencil,
  Trash2,
  ArrowUp,
  ArrowDown,
  X,
  ExternalLink,
  CalendarClock,
  Users,
} from "lucide-react";

type SliderKind = "SLIDE" | "POPUP";

type Slider = {
  id: string;
  title: string;
  imagePublicId: string;
  imageUrl: string;
  linkUrl: string | null;
  kind: SliderKind;
  audienceRoles: string[];
  active: boolean;
  sortOrder: number;
  startAt: string | null;
  endAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "RETAILER", label: "Retailer" },
  { value: "DISTRIBUTOR", label: "Distributor" },
  { value: "MASTER_DISTRIBUTOR", label: "Master Distributor" },
  { value: "SUPER_DISTRIBUTOR", label: "Super Distributor" },
  { value: "ADMIN", label: "Admin" },
  { value: "SUPPORT", label: "Sub-Admin" },
  { value: "MASTER_ADMIN", label: "Master Admin" },
];

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** ISO → value for <input type="datetime-local"> in the user's local tz. */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

/** datetime-local value → ISO (or null when empty). */
function localInputToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function scheduleLabel(s: Slider): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  if (s.startAt && s.endAt) return `${fmt(s.startAt)} → ${fmt(s.endAt)}`;
  if (s.startAt) return `From ${fmt(s.startAt)}`;
  if (s.endAt) return `Until ${fmt(s.endAt)}`;
  return "Always live";
}

type FormState = {
  id: string | null;
  title: string;
  kind: SliderKind;
  imagePublicId: string;
  imageUrl: string;
  linkUrl: string;
  audienceRoles: string[];
  active: boolean;
  sortOrder: number;
  startAt: string;
  endAt: string;
};

const emptyForm = (kind: SliderKind, sortOrder: number): FormState => ({
  id: null,
  title: "",
  kind,
  imagePublicId: "",
  imageUrl: "",
  linkUrl: "",
  audienceRoles: [],
  active: true,
  sortOrder,
  startAt: "",
  endAt: "",
});

export default function AdminSliderPage() {
  const [sliders, setSliders] = useState<Slider[]>([]);
  const [loading, setLoading] = useState(true);
  const notify = useCallback((text: string, ok: boolean) => {
    if (ok) toast.success(text);
    else toast.error(text);
  }, []);
  const [form, setForm] = useState<FormState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Slider | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchSliders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/sliders");
      const data = await res.json();
      if (Array.isArray(data.sliders)) setSliders(data.sliders);
    } catch {
      notify("Failed to load sliders.", false);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    fetchSliders();
  }, [fetchSliders]);

  const slides = useMemo(
    () => sliders.filter((s) => s.kind === "SLIDE").sort((a, b) => a.sortOrder - b.sortOrder),
    [sliders]
  );
  const popups = useMemo(
    () => sliders.filter((s) => s.kind === "POPUP").sort((a, b) => a.sortOrder - b.sortOrder),
    [sliders]
  );

  const openCreate = useCallback(
    (kind: SliderKind) => {
      const peers = sliders.filter((s) => s.kind === kind);
      const nextOrder = peers.length ? Math.max(...peers.map((s) => s.sortOrder)) + 1 : 0;
      setForm(emptyForm(kind, nextOrder));
    },
    [sliders]
  );

  const openEdit = useCallback((s: Slider) => {
    setForm({
      id: s.id,
      title: s.title,
      kind: s.kind,
      imagePublicId: s.imagePublicId,
      imageUrl: s.imageUrl,
      linkUrl: s.linkUrl ?? "",
      audienceRoles: s.audienceRoles,
      active: s.active,
      sortOrder: s.sortOrder,
      startAt: isoToLocalInput(s.startAt),
      endAt: isoToLocalInput(s.endAt),
    });
  }, []);

  const patchSlider = useCallback(
    async (s: Slider, patch: Record<string, unknown>) => {
      // Optimistic.
      setSliders((prev) => prev.map((x) => (x.id === s.id ? { ...x, ...patch } : x)));
      try {
        const res = await fetch(`/api/admin/sliders/${s.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.formErrors?.[0] ?? data?.error ?? "Update failed");
        setSliders((prev) => prev.map((x) => (x.id === s.id ? { ...x, ...data.slider } : x)));
      } catch (e) {
        setSliders((prev) => prev.map((x) => (x.id === s.id ? s : x)));
        notify(e instanceof Error ? e.message : "Update failed", false);
      }
    },
    [notify]
  );

  const move = useCallback(
    async (list: Slider[], index: number, dir: -1 | 1) => {
      const target = index + dir;
      if (target < 0 || target >= list.length) return;
      const a = list[index];
      const b = list[target];
      await Promise.all([
        patchSlider(a, { sortOrder: b.sortOrder }),
        patchSlider(b, { sortOrder: a.sortOrder }),
      ]);
    },
    [patchSlider]
  );

  const remove = useCallback(async (s: Slider) => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/sliders/${s.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Delete failed");
      setSliders((prev) => prev.filter((x) => x.id !== s.id));
      notify(`"${s.title}" deleted — audit logged.`, true);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Delete failed", false);
    } finally {
      setDeleting(false);
    }
  }, [notify]);

  const onSaved = useCallback(
    (saved: Slider, isNew: boolean) => {
      setSliders((prev) => (isNew ? [...prev, saved] : prev.map((x) => (x.id === saved.id ? saved : x))));
      setForm(null);
      notify(`"${saved.title}" ${isNew ? "created" : "updated"} — audit logged.`, true);
    },
    [notify]
  );

  return (
    <div className="space-y-6">
      <Reveal distance={14} duration={0.4}>
        <PageHeader
          eyebrow="Admin"
          title="Slider & Pop-up Manager"
          description="Manage colorful dashboard banners (carousel) and pop-up announcements. Schedule them, target specific roles, and reorder — every change is audit logged."
          actions={
            <>
              <Button variant="outline" onClick={fetchSliders} disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
              </Button>
              <Button onClick={() => openCreate("SLIDE")}>
                <Plus className="h-4 w-4" /> New slider
              </Button>
            </>
          }
        />
      </Reveal>

      {loading ? (
        <Panel className="p-10 text-center text-sm text-ink-500">
          Loading sliders…
        </Panel>
      ) : (
        <div className="space-y-10">
          <SliderSection
            heading="Slides"
            subtitle="Banner carousel on the dashboard"
            icon={<Images className="h-5 w-5" />}
            gradient="from-brand-500 to-violet-500"
            items={slides}
            onAdd={() => openCreate("SLIDE")}
            onEdit={openEdit}
            onDelete={setDeleteTarget}
            onToggle={(s) => patchSlider(s, { active: !s.active })}
            onMove={(i, dir) => move(slides, i, dir)}
          />
          <SliderSection
            heading="Pop-ups"
            subtitle="Dismissible modal announcements (shown once per user)"
            icon={<MonitorSmartphone className="h-5 w-5" />}
            gradient="from-accent-500 to-rose-500"
            items={popups}
            onAdd={() => openCreate("POPUP")}
            onEdit={openEdit}
            onDelete={setDeleteTarget}
            onToggle={(s) => patchSlider(s, { active: !s.active })}
            onMove={(i, dir) => move(popups, i, dir)}
          />
        </div>
      )}

      {form && (
        <SliderForm
          form={form}
          setForm={setForm}
          onClose={() => setForm(null)}
          onSaved={onSaved}
          onError={(text) => notify(text, false)}
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        busy={deleting}
        title={deleteTarget ? `Delete "${deleteTarget.title}"?` : "Delete?"}
        description="Its image will be removed from Cloudinary."
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!deleteTarget) return;
          await remove(deleteTarget);
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}

function SliderSection({
  heading,
  subtitle,
  icon,
  gradient,
  items,
  onAdd,
  onEdit,
  onDelete,
  onToggle,
  onMove,
}: {
  heading: string;
  subtitle: string;
  icon: React.ReactNode;
  gradient: string;
  items: Slider[];
  onAdd: () => void;
  onEdit: (s: Slider) => void;
  onDelete: (s: Slider) => void;
  onToggle: (s: Slider) => void;
  onMove: (index: number, dir: -1 | 1) => void;
}) {
  return (
    <Reveal as="section" distance={16} duration={0.45}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br ${gradient} text-white shadow-soft`}>
            {icon}
          </span>
          <div>
            <h2 className="font-display text-base font-bold text-ink-900">{heading}</h2>
            <p className="text-xs text-ink-500">{subtitle}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onAdd}>
          <Plus className="h-4 w-4" /> Add
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          compact
          icon={Images}
          message={`No ${heading.toLowerCase()} yet.`}
          cta={
            <Button variant="outline" size="sm" onClick={onAdd}>
              <Plus className="h-4 w-4" /> Add
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((s, i) => (
            <SliderCard
              key={s.id}
              s={s}
              first={i === 0}
              last={i === items.length - 1}
              onEdit={() => onEdit(s)}
              onDelete={() => onDelete(s)}
              onToggle={() => onToggle(s)}
              onUp={() => onMove(i, -1)}
              onDown={() => onMove(i, 1)}
            />
          ))}
        </div>
      )}
    </Reveal>
  );
}

function SliderCard({
  s,
  first,
  last,
  onEdit,
  onDelete,
  onToggle,
  onUp,
  onDown,
}: {
  s: Slider;
  first: boolean;
  last: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  onUp: () => void;
  onDown: () => void;
}) {
  const roleLabels =
    s.audienceRoles.length === 0
      ? "All roles"
      : s.audienceRoles
          .map((r) => ROLE_OPTIONS.find((o) => o.value === r)?.label ?? r)
          .join(", ");

  return (
    <Panel
      interactive
      flush
      className={`group relative overflow-hidden ${s.active ? "border-transparent ring-2 ring-brand-200" : "opacity-90"}`}
    >
      <div className="relative aspect-[16/7] w-full overflow-hidden bg-ink-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={s.imageUrl} alt={s.title} className="h-full w-full object-contain" />
        <div className="absolute right-2 top-2 flex gap-1">
          <span className="rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-bold text-ink-700 shadow">#{s.sortOrder}</span>
          <StatusPill
            status={s.active ? "LIVE" : "OFF"}
            tone={s.active ? "success" : "danger"}
            className="bg-white/90 shadow"
          />
        </div>
      </div>

      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate font-display text-sm font-semibold text-ink-900">{s.title}</h3>
          {s.linkUrl && (
            <a href={s.linkUrl} target="_blank" rel="noreferrer" className="shrink-0 text-brand-600 hover:text-brand-700" title={s.linkUrl}>
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </div>

        <div className="space-y-1.5 text-xs text-ink-500">
          <p className="flex items-center gap-1.5">
            <CalendarClock className="h-3.5 w-3.5 shrink-0" /> {scheduleLabel(s)}
          </p>
          <p className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{roleLabels}</span>
          </p>
        </div>

        <div className="flex items-center justify-between border-t border-ink-100 pt-3">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onUp}
              disabled={first}
              className="grid h-8 w-8 place-items-center rounded-lg text-ink-600 transition hover:bg-brand-50 hover:text-brand-700 disabled:opacity-30"
              aria-label="Move up"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onDown}
              disabled={last}
              className="grid h-8 w-8 place-items-center rounded-lg text-ink-600 transition hover:bg-brand-50 hover:text-brand-700 disabled:opacity-30"
              aria-label="Move down"
            >
              <ArrowDown className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onToggle}
              className="rounded-lg border border-ink-200 px-2.5 py-1.5 text-xs font-semibold text-ink-700 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
            >
              {s.active ? "Disable" : "Enable"}
            </button>
            <button
              type="button"
              onClick={onEdit}
              className="grid h-8 w-8 place-items-center rounded-lg text-brand-700 transition hover:bg-brand-50 disabled:opacity-30"
              aria-label="Edit"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="grid h-8 w-8 place-items-center rounded-lg text-rose-700 transition hover:bg-rose-50 disabled:opacity-30"
              aria-label="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function SliderForm({
  form,
  setForm,
  onClose,
  onSaved,
  onError,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState | null>>;
  onClose: () => void;
  onSaved: (s: Slider, isNew: boolean) => void;
  onError: (text: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  const toggleRole = (role: string) =>
    setForm((f) => {
      if (!f) return f;
      const has = f.audienceRoles.includes(role);
      return {
        ...f,
        audienceRoles: has ? f.audienceRoles.filter((r) => r !== role) : [...f.audienceRoles, role],
      };
    });

  // "All roles" explicitly selects every role chip. (An empty selection is also
  // treated as "visible to everyone" by the API, so both are equivalent.)
  const allRolesSelected = ROLE_OPTIONS.every((r) =>
    form.audienceRoles.includes(r.value)
  );
  const selectAllRoles = () => set("audienceRoles", ROLE_OPTIONS.map((r) => r.value));

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      onError("Please choose an image file.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      onError("Image must be 5MB or smaller.");
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const res = await fetch("/api/admin/sliders/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.formErrors?.[0] ?? data?.error ?? "Upload failed");
      setForm((f) => (f ? { ...f, imagePublicId: data.publicId, imageUrl: data.url } : f));
    } catch (e) {
      onError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return onError("Title is required.");
    if (!form.imageUrl || !form.imagePublicId) return onError("Please upload an image.");
    if (form.startAt && form.endAt && new Date(form.startAt) > new Date(form.endAt))
      return onError("End time must be after start time.");

    setSaving(true);
    const isNew = !form.id;
    const payload = {
      title: form.title.trim(),
      kind: form.kind,
      imagePublicId: form.imagePublicId,
      imageUrl: form.imageUrl,
      linkUrl: form.linkUrl.trim() ? form.linkUrl.trim() : null,
      audienceRoles: form.audienceRoles,
      active: form.active,
      sortOrder: form.sortOrder,
      startAt: localInputToIso(form.startAt),
      endAt: localInputToIso(form.endAt),
    };

    try {
      const res = await fetch(isNew ? "/api/admin/sliders" : `/api/admin/sliders/${form.id}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        const fieldErr = data?.error?.fieldErrors
          ? Object.values(data.error.fieldErrors).flat()[0]
          : null;
        throw new Error(fieldErr ?? data?.error?.formErrors?.[0] ?? data?.error ?? "Save failed");
      }
      onSaved(data.slider, isNew);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[#0b1030]/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="h-full w-full max-w-lg overflow-y-auto bg-white shadow-2xl sm:rounded-l-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 border-b border-ink-100 bg-white/95 backdrop-blur">
          <div className="h-1 w-full bg-gradient-to-r from-brand-500 via-brand-400 to-accent-500" aria-hidden />
          <div className="flex items-center justify-between px-6 py-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-700">
                {form.id ? "Edit" : "New"} {form.kind === "SLIDE" ? "Slider" : "Pop-up"}
              </p>
              <h2 className="font-display text-lg font-bold text-ink-900">
                {form.kind === "SLIDE" ? "Carousel banner" : "Pop-up announcement"}
              </h2>
            </div>
            <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg text-ink-500 transition hover:bg-ink-100">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-5 p-6">
          <div>
            <Label>Image</Label>
            <div className="overflow-hidden rounded-xl border border-ink-200 bg-ink-50">
              {form.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.imageUrl} alt="Preview" className="aspect-[16/7] w-full object-contain" />
              ) : (
                <div className="grid aspect-[16/7] w-full place-items-center text-ink-400">
                  <div className="text-center">
                    <Images className="mx-auto h-8 w-8" />
                    <p className="mt-1 text-xs">No image yet</p>
                  </div>
                </div>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 w-full"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploading ? "Uploading…" : form.imageUrl ? "Replace image" : "Upload image"}
            </Button>
          </div>

          <div>
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={form.title}
              maxLength={120}
              onChange={(e) => set("title", e.target.value)}
              placeholder="e.g. Diwali cashback bonanza"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="kind">Type</Label>
              <Select id="kind" value={form.kind} onChange={(e) => set("kind", e.target.value as SliderKind)}>
                <option value="SLIDE">Slide (carousel)</option>
                <option value="POPUP">Pop-up (modal)</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="sortOrder">Sort order</Label>
              <Input
                id="sortOrder"
                type="number"
                min={0}
                value={form.sortOrder}
                onChange={(e) => set("sortOrder", Number(e.target.value) || 0)}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="linkUrl">Click-through link (optional)</Label>
            <Input
              id="linkUrl"
              value={form.linkUrl}
              onChange={(e) => set("linkUrl", e.target.value)}
              placeholder="https://…"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="startAt">Start (optional)</Label>
              <Input id="startAt" type="datetime-local" value={form.startAt} onChange={(e) => set("startAt", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="endAt">End (optional)</Label>
              <Input id="endAt" type="datetime-local" value={form.endAt} onChange={(e) => set("endAt", e.target.value)} />
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label className="mb-0">Audience roles</Label>
              <button
                type="button"
                onClick={selectAllRoles}
                disabled={allRolesSelected}
                className="text-xs font-semibold text-brand-600 transition hover:text-brand-700 disabled:cursor-default disabled:text-ink-400"
              >
                All roles
              </button>
            </div>
            <p className="mb-2 text-xs text-ink-500">No selection = visible to everyone (all roles).</p>
            <div className="flex flex-wrap gap-2">
              {ROLE_OPTIONS.map((r) => {
                const on = form.audienceRoles.includes(r.value);
                return (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => toggleRole(r.value)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      on
                        ? "border-transparent bg-gradient-to-r from-brand-600 to-brand-500 text-white shadow-soft"
                        : "border-ink-200 bg-white text-ink-600 hover:border-brand-300"
                    }`}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="flex cursor-pointer items-center justify-between rounded-xl border border-ink-200 px-4 py-3 transition-colors hover:border-brand-300 hover:bg-brand-50/40">
            <span className="text-sm font-medium text-ink-800">Active</span>
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => set("active", e.target.checked)}
              className="h-5 w-5 accent-brand-600"
            />
          </label>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={saving || uploading}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {form.id ? "Save changes" : "Create"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
