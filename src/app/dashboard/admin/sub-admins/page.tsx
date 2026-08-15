"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  UserCog,
  Plus,
  Copy,
  Check,
  ShieldOff,
  ShieldCheck,
  Trash2,
  KeyRound,
  X,
  Eye,
  EyeOff,
  ListChecks,
  Smartphone,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input, Label } from "@/components/ui/Input";
import { ReportActions } from "@/components/dashboard/ReportActions";
import { generateRandomPassword } from "@/lib/utils";
import { ASSIGNABLE_SUB_ADMIN_TABS } from "@/lib/roles";

type SubAdmin = {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: string;
  allowedTabs: string[];
  twoFactorEnabled: boolean;
  createdAt: string;
};

export default function AdminSubAdminsPage() {
  const [rows, setRows] = useState<SubAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [tabsFor, setTabsFor] = useState<SubAdmin | null>(null);
  const [issued, setIssued] = useState<{
    record: SubAdmin;
    password: string;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SubAdmin | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [resetPwd, setResetPwd] = useState<{ name: string; password: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/sub-admins");
      const data = await res.json();
      if (res.ok) setRows(data.subAdmins ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const stats = useMemo(() => {
    const active = rows.filter((r) => r.status === "ACTIVE").length;
    const with2FA = rows.filter((r) => r.twoFactorEnabled).length;
    return { total: rows.length, active, with2FA };
  }, [rows]);

  async function handleDelete(r: SubAdmin) {
    setDeleting(true);
    try {
      await fetch(`/api/admin/sub-admins/${r.id}`, {
        method: "DELETE",
      });
      toast.success(`Sub-admin ${r.name} deleted.`);
      refresh();
    } finally {
      setDeleting(false);
    }
  }

  async function handleResetPassword(r: SubAdmin) {
    try {
      const res = await fetch(`/api/admin/sub-admins/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset-password" }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(typeof data.error === "string" ? data.error : "Failed to reset password");
        return;
      }
      setResetPwd({ name: r.name, password: data.password });
    } catch {
      toast.error("Network error. Please try again.");
    }
  }

  async function handleReset2fa(r: SubAdmin) {
    if (
      !confirm(
        `Reset 2FA for ${r.name}? They will set up a new authenticator on next login.`
      )
    )
      return;
    try {
      const res = await fetch(`/api/admin/sub-admins/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset-2fa" }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(typeof data.error === "string" ? data.error : "Failed to reset 2FA");
        return;
      }
      toast.success(`2FA reset for ${r.name}. They must re-enroll on next login.`);
      refresh();
    } catch {
      toast.error("Network error. Please try again.");
    }
  }

  const cols: Column<SubAdmin>[] = [
    {
      key: "id",
      header: "ID",
      render: (r) => (
        <span className="font-mono text-xs">{r.id.slice(0, 8)}</span>
      ),
    },
    {
      key: "name",
      header: "Sub-admin",
      render: (r) => (
        <div>
          <div className="font-semibold text-ink-900">{r.name}</div>
          <div className="text-xs text-ink-500">{r.email}</div>
        </div>
      ),
    },
    { key: "phone", header: "Mobile" },
    {
      key: "twoFactorEnabled",
      header: "2FA",
      render: (r) =>
        r.twoFactorEnabled ? (
          <Badge variant="success">Enabled</Badge>
        ) : (
          <Badge variant="warning">Not set up</Badge>
        ),
    },
    {
      key: "allowedTabs",
      header: "Tabs",
      render: (r) =>
        (r.allowedTabs ?? []).length === 0 ? (
          <Badge variant="accent">All tabs</Badge>
        ) : (
          <span className="text-xs text-ink-700">
            {r.allowedTabs.length} of {ASSIGNABLE_SUB_ADMIN_TABS.length}
          </span>
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <Badge
          variant={
            r.status === "ACTIVE"
              ? "success"
              : r.status === "SUSPENDED"
                ? "danger"
                : "default"
          }
        >
          {r.status}
        </Badge>
      ),
    },
    {
      key: "createdAt",
      header: "Created",
      render: (r) => new Date(r.createdAt).toLocaleString("en-IN"),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (r) => (
        <div className="flex justify-end gap-1">
          <button
            onClick={() => setTabsFor(r)}
            className="grid h-8 w-8 place-items-center rounded-lg text-violet-700 hover:bg-violet-50"
            title="Assign tabs"
          >
            <ListChecks className="h-4 w-4" />
          </button>
          <button
            onClick={() => handleResetPassword(r)}
            className="grid h-8 w-8 place-items-center rounded-lg text-amber-700 hover:bg-amber-50"
            title="Reset password"
          >
            <KeyRound className="h-4 w-4" />
          </button>
          <button
            onClick={() => handleReset2fa(r)}
            className="grid h-8 w-8 place-items-center rounded-lg text-amber-700 hover:bg-amber-50"
            title="Reset 2FA"
          >
            <Smartphone className="h-4 w-4" />
          </button>
          {r.status === "ACTIVE" ? (
            <button
              onClick={async () => {
                await fetch(`/api/admin/sub-admins/${r.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "suspend" }),
                });
                refresh();
              }}
              className="grid h-8 w-8 place-items-center rounded-lg text-rose-700 hover:bg-rose-50"
              title="Suspend"
            >
              <ShieldOff className="h-4 w-4" />
            </button>
          ) : r.status === "SUSPENDED" ? (
            <button
              onClick={async () => {
                await fetch(`/api/admin/sub-admins/${r.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "activate" }),
                });
                refresh();
              }}
              className="grid h-8 w-8 place-items-center rounded-lg text-emerald-700 hover:bg-emerald-50"
              title="Reactivate"
            >
              <ShieldCheck className="h-4 w-4" />
            </button>
          ) : null}
          <button
            onClick={() => setDeleteTarget(r)}
            className="grid h-8 w-8 place-items-center rounded-lg text-rose-700 hover:bg-rose-50"
            title="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="Sub-admins"
        description="Create operations users delegated by you. Each sub-admin signs in at /sub-admin with 2FA enforced."
        actions={
          <>
            <ReportActions
              filename="sub-admins"
              title="Paybridgex · Sub-Admins"
              columns={[
                { key: "id", header: "ID" },
                { key: "name", header: "Name" },
                { key: "email", header: "Email" },
                { key: "phone", header: "Mobile" },
                { key: "status", header: "Status" },
                {
                  key: "twoFactorEnabled",
                  header: "2FA",
                  render: (r) => (r.twoFactorEnabled ? "Yes" : "No"),
                },
                {
                  key: "createdAt",
                  header: "Created",
                  render: (r) => new Date(r.createdAt).toLocaleString("en-IN"),
                },
              ]}
              rows={rows}
            />
            <Button onClick={() => setShowNew(true)}>
              <Plus className="h-4 w-4" /> Create sub-admin
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Total sub-admins" value={stats.total} tone="brand" />
        <Stat label="Active" value={stats.active} tone="success" />
        <Stat label="2FA enabled" value={stats.with2FA} tone="warning" />
      </div>

      {showNew && (
        <NewSubAdminForm
          onCancel={() => setShowNew(false)}
          onCreated={(record, password) => {
            setShowNew(false);
            setIssued({ record, password });
            refresh();
          }}
        />
      )}

      {issued && (
        <CredentialsDialog
          record={issued.record}
          password={issued.password}
          onClose={() => setIssued(null)}
        />
      )}

      {resetPwd && (
        <ResetPasswordDialog
          name={resetPwd.name}
          password={resetPwd.password}
          onClose={() => setResetPwd(null)}
        />
      )}

      {tabsFor && (
        <TabsDialog
          record={tabsFor}
          onClose={() => setTabsFor(null)}
          onSaved={() => {
            setTabsFor(null);
            refresh();
          }}
        />
      )}

      <DataTable
        title={`${rows.length} sub-admins`}
        loading={loading}
        description="Sub-admins log in at /sub-admin and inherit a restricted operations dashboard."
        columns={cols}
        data={rows}
        empty="No sub-admins created yet. Click 'Create sub-admin' to issue the first credentials."
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        busy={deleting}
        title={deleteTarget ? `Delete sub-admin ${deleteTarget.name}?` : "Delete sub-admin?"}
        description="This cannot be undone."
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!deleteTarget) return;
          await handleDelete(deleteTarget);
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}

/* ----------------------------------------------------------------------- */

function NewSubAdminForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (r: SubAdmin, password: string) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("+91 ");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const password = generateRandomPassword(10);
      const res = await fetch("/api/admin/sub-admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, phone, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          typeof data.error === "string"
            ? data.error
            : "Failed to create sub-admin.",
        );
        setSubmitting(false);
        return;
      }
      onCreated(data.subAdmin, password);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50/60 to-white p-5"
    >
      <div className="mb-4 flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-ink-900 text-white">
          <UserCog className="h-4 w-4" />
        </span>
        <div>
          <h3 className="font-display text-base font-semibold text-ink-900">
            New sub-admin
          </h3>
          <p className="text-xs text-ink-500">
            A 10-character password will be generated. Share it once — the
            sub-admin must set up 2FA on first login.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <Label htmlFor="sa-name">Full name</Label>
          <Input
            id="sa-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="As per ID proof"
          />
        </div>
        <div>
          <Label htmlFor="sa-email">Email</Label>
          <Input
            id="sa-email"
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ops.user@company.com"
          />
        </div>
        <div>
          <Label htmlFor="sa-phone">Mobile</Label>
          <Input
            id="sa-phone"
            required
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+91 9XXXXXXXXX"
          />
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" isLoading={submitting}>
          <KeyRound className="h-4 w-4" />
          Generate password & create
        </Button>
      </div>
    </form>
  );
}

function TabsDialog({
  record,
  onClose,
  onSaved,
}: {
  record: SubAdmin;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [picked, setPicked] = useState<string[]>(record.allowedTabs ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(slug: string) {
    setPicked((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    );
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/sub-admins/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update-tabs", allowedTabs: picked }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(
          typeof data?.error === "string" ? data.error : "Failed to save tabs"
        );
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save tabs");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-900/40 px-4">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 bg-gradient-to-br from-violet-50 to-white px-6 py-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-violet-700">
              Assign tabs
            </p>
            <h3 className="mt-1 font-display text-lg font-bold text-ink-900">
              {record.name}
            </h3>
            <p className="mt-1 text-xs text-ink-600">
              Pick the workspace tabs this sub-admin may access. Leaving all
              unticked grants the full sub-admin menu.
            </p>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-ink-500 hover:bg-ink-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <p className="mx-6 mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}

        <div className="grid gap-2 px-6 py-4 sm:grid-cols-2">
          {ASSIGNABLE_SUB_ADMIN_TABS.map((tab) => {
            const on = picked.includes(tab.href);
            return (
              <label
                key={tab.href}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition ${
                  on
                    ? "border-violet-200 bg-violet-50 text-violet-800"
                    : "border-ink-200 bg-white text-ink-600"
                }`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(tab.href)}
                  className="h-4 w-4 rounded border-ink-300 text-violet-600 focus:ring-violet-500"
                />
                <span className="flex-1 truncate">{tab.label}</span>
              </label>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-ink-100 bg-ink-50/40 px-6 py-3">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} isLoading={saving}>
            Save tabs
          </Button>
        </div>
      </div>
    </div>
  );
}

function CredentialsDialog({
  record,
  password,
  onClose,
}: {
  record: SubAdmin;
  password: string;
  onClose: () => void;
}) {
  const [showPwd, setShowPwd] = useState(true);
  const [copied, setCopied] = useState<"none" | "email" | "pwd" | "both">(
    "none",
  );

  const copy = async (text: string, which: "email" | "pwd" | "both") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied("none"), 1800);
    } catch {
      /* ignore */
    }
  };

  const both = `Login URL: ${typeof window !== "undefined" ? window.location.origin : ""}/sub-admin\nEmail: ${record.email}\nPassword: ${password}`;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-900/40 px-4">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 bg-gradient-to-br from-emerald-50 to-white px-6 py-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">
              Sub-admin created
            </p>
            <h3 className="mt-1 font-display text-lg font-bold text-ink-900">
              {record.name}
            </h3>
            <p className="mt-1 text-xs text-ink-600">
              Share these credentials securely. The sub-admin will be required to
              set up 2FA on first login.
            </p>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-ink-500 hover:bg-ink-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-6 py-5">
          <Field label="Login URL" value="/sub-admin" />
          <Field
            label="Email"
            value={record.email}
            action={
              <button
                type="button"
                onClick={() => copy(record.email, "email")}
                className="grid h-8 w-8 place-items-center rounded-lg text-ink-500 hover:bg-ink-100"
                title="Copy email"
              >
                {copied === "email" ? (
                  <Check className="h-4 w-4 text-emerald-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
            }
          />
          <Field
            label="Temporary password"
            mono
            value={showPwd ? password : "••••••••••"}
            action={
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowPwd((s) => !s)}
                  className="grid h-8 w-8 place-items-center rounded-lg text-ink-500 hover:bg-ink-100"
                  title={showPwd ? "Hide" : "Show"}
                >
                  {showPwd ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => copy(password, "pwd")}
                  className="grid h-8 w-8 place-items-center rounded-lg text-ink-500 hover:bg-ink-100"
                  title="Copy password"
                >
                  {copied === "pwd" ? (
                    <Check className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>
            }
          />

          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            For security, this password will{" "}
            <strong>not be shown again</strong>. Copy it now and send it to the
            sub-admin via a secure channel.
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-ink-100 bg-ink-50/40 px-6 py-3">
          <Button variant="outline" onClick={() => copy(both, "both")}>
            {copied === "both" ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            Copy all
          </Button>
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}

function ResetPasswordDialog({
  name,
  password,
  onClose,
}: {
  name: string;
  password: string;
  onClose: () => void;
}) {
  const [showPwd, setShowPwd] = useState(true);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-900/40 px-4">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 bg-gradient-to-br from-amber-50 to-white px-6 py-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700">
              Password reset
            </p>
            <h3 className="mt-1 font-display text-lg font-bold text-ink-900">{name}</h3>
            <p className="mt-1 text-xs text-ink-600">
              A new password was generated for this sub-admin. All existing sessions
              have been signed out.
            </p>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-ink-500 hover:bg-ink-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-6 py-5">
          <Field
            label="New password"
            mono
            value={showPwd ? password : "••••••••••"}
            action={
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowPwd((s) => !s)}
                  className="grid h-8 w-8 place-items-center rounded-lg text-ink-500 hover:bg-ink-100"
                  title={showPwd ? "Hide" : "Show"}
                >
                  {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  onClick={copy}
                  className="grid h-8 w-8 place-items-center rounded-lg text-ink-500 hover:bg-ink-100"
                  title="Copy password"
                >
                  {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
            }
          />
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            For security, this password will <strong>not be shown again</strong>. Copy it
            now and send it to the sub-admin via a secure channel.
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-ink-100 bg-ink-50/40 px-6 py-3">
          <Button variant="outline" onClick={copy}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            Copy password
          </Button>
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
  action,
}: {
  label: string;
  value: string;
  mono?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-ink-100 bg-white px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-ink-500">
        {label}
      </p>
      <div className="mt-1 flex items-center justify-between gap-3">
        <p
          className={`truncate text-sm text-ink-900 ${mono ? "font-mono" : "font-semibold"}`}
        >
          {value}
        </p>
        {action}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "brand" | "success" | "warning";
}) {
  const map = {
    brand: "from-brand-500 to-brand-700 text-brand-50",
    success: "from-emerald-500 to-emerald-700 text-emerald-50",
    warning: "from-amber-500 to-amber-700 text-amber-50",
  };
  return (
    <div
      className={`rounded-2xl bg-gradient-to-br ${map[tone]} p-5 shadow-soft`}
    >
      <p className="text-xs font-bold uppercase tracking-widest opacity-90">
        {label}
      </p>
      <p className="mt-2 font-display text-3xl font-bold">{value}</p>
    </div>
  );
}
