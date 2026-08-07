"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Crown,
  Plus,
  ShieldOff,
  ShieldCheck,
  Trash2,
  KeyRound,
  X,
  Eye,
  EyeOff,
  Copy,
  Check,
  Settings2,
  Star,
  Smartphone
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input, Label } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ASSIGNABLE_ADMIN_TABS } from "@/lib/roles";
import { generateRandomPassword } from "@/lib/utils";

type AdminRecord = {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: string;
  allowedTabs: string[];
  createdAt: string;
};

type MasterAdminRecord = {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: string;
  allowedTabs: string[];
  createdAt: string;
};

export default function ManageAdminsPage() {
  const [tab, setTab] = useState<"admins" | "master-admins">("admins");
  const [rows, setRows] = useState<AdminRecord[]>([]);
  const [masterRows, setMasterRows] = useState<MasterAdminRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [showNewMaster, setShowNewMaster] = useState(false);
  const [editingAdmin, setEditingAdmin] = useState<AdminRecord | null>(null);
  const [created, setCreated] = useState<{ admin: AdminRecord | MasterAdminRecord; password: string; isMaster: boolean } | null>(null);
  const [resetPwd, setResetPwd] = useState<{ name: string; password: string; isMaster: boolean } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminRecord | null>(null);
  const [deleteMasterTarget, setDeleteMasterTarget] = useState<MasterAdminRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [adminsRes, masterRes] = await Promise.all([
        fetch("/api/admin/admins"),
        fetch("/api/admin/master-admins"),
      ]);
      if (adminsRes.ok) {
        const data = await adminsRes.json();
        setRows(data.admins);
      }
      if (masterRes.ok) {
        const data = await masterRes.json();
        setMasterRows(data.masterAdmins);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const stats = useMemo(() => {
    const active = rows.filter((r) => r.status === "ACTIVE").length;
    const suspended = rows.filter((r) => r.status === "SUSPENDED").length;
    return { total: rows.length, active, suspended };
  }, [rows]);

  const masterStats = useMemo(() => {
    const active = masterRows.filter((r) => r.status === "ACTIVE").length;
    return { total: masterRows.length, active };
  }, [masterRows]);

  async function handleAction(id: string, action: string) {
    await fetch(`/api/admin/admins/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    refresh();
  }

  async function handleMasterAction(id: string, action: string) {
    await fetch(`/api/admin/master-admins/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    refresh();
  }

  async function handleResetPassword(
    r: AdminRecord | MasterAdminRecord,
    isMaster: boolean
  ) {
    const endpoint = isMaster ? "master-admins" : "admins";
    try {
      const res = await fetch(`/api/admin/${endpoint}/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset-password" }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(typeof data.error === "string" ? data.error : "Failed to reset password");
        return;
      }
      setResetPwd({ name: r.name, password: data.password, isMaster });
    } catch {
      toast.error("Network error. Please try again.");
    }
  }

  async function handleReset2fa(
    r: AdminRecord | MasterAdminRecord,
    isMaster: boolean
  ) {
    if (
      !confirm(
        `Reset 2FA for ${r.name}? They will set up a new authenticator on next login.`
      )
    )
      return;
    const endpoint = isMaster ? "master-admins" : "admins";
    try {
      const res = await fetch(`/api/admin/${endpoint}/${r.id}`, {
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

  async function handleDelete(admin: AdminRecord) {
    setDeleting(true);
    try {
      await fetch(`/api/admin/admins/${admin.id}`, { method: "DELETE" });
      toast.success(`Admin ${admin.name} deleted.`);
      refresh();
    } finally {
      setDeleting(false);
    }
  }

  async function handleDeleteMaster(admin: MasterAdminRecord) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/master-admins/${admin.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to delete");
        return;
      }
      toast.success(`Master admin ${admin.name} deleted.`);
      refresh();
    } finally {
      setDeleting(false);
    }
  }

  const cols: Column<AdminRecord>[] = [
    {
      key: "name",
      header: "Admin",
      render: (r) => (
        <div>
          <div className="font-semibold text-ink-900">{r.name}</div>
          <div className="text-xs text-ink-500">{r.email}</div>
        </div>
      )
    },
    { key: "phone", header: "Mobile" },
    {
      key: "allowedTabs",
      header: "Permissions",
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.allowedTabs.length === 0 || r.allowedTabs.length >= ASSIGNABLE_ADMIN_TABS.length ? (
            <Badge variant="success">All access</Badge>
          ) : (
            <Badge variant="default">
              {r.allowedTabs.length} of {ASSIGNABLE_ADMIN_TABS.length} tabs
            </Badge>
          )}
        </div>
      )
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <Badge variant={r.status === "ACTIVE" ? "success" : r.status === "SUSPENDED" ? "danger" : "default"}>
          {r.status === "ACTIVE" ? "Active" : r.status === "SUSPENDED" ? "Suspended" : r.status}
        </Badge>
      )
    },
    {
      key: "createdAt",
      header: "Created",
      render: (r) => new Date(r.createdAt).toLocaleString("en-IN")
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (r) => (
        <div className="flex justify-end gap-1">
          <button
            onClick={() => setEditingAdmin(r)}
            className="grid h-8 w-8 place-items-center rounded-lg text-brand-700 hover:bg-brand-50"
            title="Edit permissions"
          >
            <Settings2 className="h-4 w-4" />
          </button>
          <button
            onClick={() => handleResetPassword(r, false)}
            className="grid h-8 w-8 place-items-center rounded-lg text-amber-700 hover:bg-amber-50"
            title="Reset password"
          >
            <KeyRound className="h-4 w-4" />
          </button>
          <button
            onClick={() => handleReset2fa(r, false)}
            className="grid h-8 w-8 place-items-center rounded-lg text-amber-700 hover:bg-amber-50"
            title="Reset 2FA"
          >
            <Smartphone className="h-4 w-4" />
          </button>
          {r.status === "ACTIVE" ? (
            <button
              onClick={() => handleAction(r.id, "suspend")}
              className="grid h-8 w-8 place-items-center rounded-lg text-rose-700 hover:bg-rose-50"
              title="Suspend"
            >
              <ShieldOff className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={() => handleAction(r.id, "activate")}
              className="grid h-8 w-8 place-items-center rounded-lg text-emerald-700 hover:bg-emerald-50"
              title="Reactivate"
            >
              <ShieldCheck className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={() => setDeleteTarget(r)}
            className="grid h-8 w-8 place-items-center rounded-lg text-rose-700 hover:bg-rose-50"
            title="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )
    }
  ];

  const masterCols: Column<MasterAdminRecord>[] = [
    {
      key: "name",
      header: "Master Admin",
      render: (r) => (
        <div>
          <div className="flex items-center gap-2">
            <Star className="h-4 w-4 text-amber-500" />
            <span className="font-semibold text-ink-900">{r.name}</span>
          </div>
          <div className="ml-6 text-xs text-ink-500">{r.email}</div>
        </div>
      )
    },
    { key: "phone", header: "Mobile" },
    {
      key: "allowedTabs",
      header: "Permissions",
      render: () => (
        <div className="flex flex-wrap gap-1">
          <Badge variant="success">All access</Badge>
        </div>
      )
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <Badge variant={r.status === "ACTIVE" ? "success" : r.status === "SUSPENDED" ? "danger" : "default"}>
          {r.status === "ACTIVE" ? "Active" : r.status === "SUSPENDED" ? "Suspended" : r.status}
        </Badge>
      )
    },
    {
      key: "createdAt",
      header: "Created",
      render: (r) => new Date(r.createdAt).toLocaleString("en-IN")
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (r) => (
        <div className="flex justify-end gap-1">
          <button
            onClick={() => handleResetPassword(r, true)}
            className="grid h-8 w-8 place-items-center rounded-lg text-amber-700 hover:bg-amber-50"
            title="Reset password"
          >
            <KeyRound className="h-4 w-4" />
          </button>
          <button
            onClick={() => handleReset2fa(r, true)}
            className="grid h-8 w-8 place-items-center rounded-lg text-amber-700 hover:bg-amber-50"
            title="Reset 2FA"
          >
            <Smartphone className="h-4 w-4" />
          </button>
          {r.status === "ACTIVE" ? (
            <button
              onClick={() => handleMasterAction(r.id, "suspend")}
              className="grid h-8 w-8 place-items-center rounded-lg text-rose-700 hover:bg-rose-50"
              title="Suspend"
            >
              <ShieldOff className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={() => handleMasterAction(r.id, "activate")}
              className="grid h-8 w-8 place-items-center rounded-lg text-emerald-700 hover:bg-emerald-50"
              title="Reactivate"
            >
              <ShieldCheck className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={() => setDeleteMasterTarget(r)}
            className="grid h-8 w-8 place-items-center rounded-lg text-rose-700 hover:bg-rose-50"
            title="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )
    }
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Master Admin"
        title="Manage Admins"
        description="Create and manage admin accounts. Master admins have full platform access; regular admins can be scoped to specific tabs."
        actions={
          tab === "admins" ? (
            <Button onClick={() => setShowNew(true)}>
              <Plus className="h-4 w-4" /> Create admin
            </Button>
          ) : (
            <Button onClick={() => setShowNewMaster(true)}>
              <Plus className="h-4 w-4" /> Add master admin
            </Button>
          )
        }
      />

      {/* Tab switcher */}
      <div className="flex gap-1 rounded-xl border border-ink-100 bg-white p-1 w-fit">
        <button
          onClick={() => setTab("admins")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
            tab === "admins"
              ? "bg-brand-600 text-white shadow-sm"
              : "text-ink-600 hover:bg-ink-50"
          }`}
        >
          Admins ({rows.length})
        </button>
        <button
          onClick={() => setTab("master-admins")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
            tab === "master-admins"
              ? "bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-sm"
              : "text-ink-600 hover:bg-ink-50"
          }`}
        >
          <span className="flex items-center gap-1.5">
            <Star className="h-3.5 w-3.5" /> Master Admins ({masterRows.length})
          </span>
        </button>
      </div>

      {tab === "admins" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Total admins" value={stats.total} tone="brand" />
            <Stat label="Active" value={stats.active} tone="success" />
            <Stat label="Suspended" value={stats.suspended} tone="warning" />
          </div>

          {showNew && (
            <NewAdminForm
              onCancel={() => setShowNew(false)}
              onCreated={(admin, password) => {
                setShowNew(false);
                setCreated({ admin, password, isMaster: false });
                refresh();
              }}
            />
          )}

          {editingAdmin && (
            <EditTabsDialog
              admin={editingAdmin}
              onClose={() => setEditingAdmin(null)}
              onSaved={() => {
                setEditingAdmin(null);
                refresh();
              }}
            />
          )}

          <DataTable
            title={`${rows.length} admin${rows.length !== 1 ? "s" : ""}`}
            description="Admins log in at /admin and see only the tabs you have assigned."
            columns={cols}
            data={rows}
            loading={loading}
            empty="No admins created yet. Click 'Create admin' to get started."
          />
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Stat label="Total master admins" value={masterStats.total} tone="brand" />
            <Stat label="Active" value={masterStats.active} tone="success" />
          </div>

          {showNewMaster && (
            <NewMasterAdminForm
              onCancel={() => setShowNewMaster(false)}
              onCreated={(admin, password) => {
                setShowNewMaster(false);
                setCreated({ admin, password, isMaster: true });
                refresh();
              }}
            />
          )}

          <DataTable
            title={`${masterRows.length} master admin${masterRows.length !== 1 ? "s" : ""}`}
            description="Master admins always have full access to every tab."
            columns={masterCols}
            data={masterRows}
            empty="No other master admins yet."
            loading={loading}
          />
        </>
      )}

      {created && (
        <CredentialsDialog
          admin={created.admin}
          password={created.password}
          isMaster={created.isMaster}
          onClose={() => setCreated(null)}
        />
      )}

      {resetPwd && (
        <ResetPasswordDialog
          name={resetPwd.name}
          password={resetPwd.password}
          isMaster={resetPwd.isMaster}
          onClose={() => setResetPwd(null)}
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        busy={deleting}
        title={deleteTarget ? `Delete admin ${deleteTarget.name}?` : "Delete admin?"}
        description="This cannot be undone."
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!deleteTarget) return;
          await handleDelete(deleteTarget);
          setDeleteTarget(null);
        }}
      />

      <ConfirmDialog
        open={deleteMasterTarget !== null}
        onClose={() => setDeleteMasterTarget(null)}
        busy={deleting}
        title={deleteMasterTarget ? `Delete master admin ${deleteMasterTarget.name}?` : "Delete master admin?"}
        description="This master admin will lose all platform access. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!deleteMasterTarget) return;
          await handleDeleteMaster(deleteMasterTarget);
          setDeleteMasterTarget(null);
        }}
      />
    </div>
  );
}

/* ----------------------------------------------------------------------- */

function NewAdminForm({
  onCancel,
  onCreated
}: {
  onCancel: () => void;
  onCreated: (admin: AdminRecord, password: string) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("+91 ");
  const [role, setRole] = useState<"ADMIN" | "FINANCE">("ADMIN");
  const [selectedTabs, setSelectedTabs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function toggleTab(href: string) {
    setSelectedTabs((prev) =>
      prev.includes(href) ? prev.filter((t) => t !== href) : [...prev, href]
    );
  }

  function selectAll() {
    setSelectedTabs(ASSIGNABLE_ADMIN_TABS.map((t) => t.href));
  }

  function clearAll() {
    setSelectedTabs([]);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const password = generateRandomPassword(12);
      const res = await fetch("/api/admin/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          phone,
          password,
          allowedTabs: selectedTabs,
          role,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create admin");
      onCreated(data.admin, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50/60 to-white p-5"
    >
      <div className="mb-4 flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-800 text-white">
          <Crown className="h-4 w-4" />
        </span>
        <div>
          <h3 className="font-display text-base font-semibold text-ink-900">
            New admin
          </h3>
          <p className="text-xs text-ink-500">
            Create a new admin account. A password will be generated — share it
            securely.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <Label htmlFor="adm-name">Full name</Label>
          <Input
            id="adm-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Admin full name"
          />
        </div>
        <div>
          <Label htmlFor="adm-email">Email</Label>
          <Input
            id="adm-email"
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@nxtgpay.com"
          />
        </div>
        <div>
          <Label htmlFor="adm-phone">Mobile</Label>
          <Input
            id="adm-phone"
            required
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+91 9XXXXXXXXX"
          />
        </div>
      </div>

      <div className="mt-4">
        <Label>Staff role</Label>
        <div className="mt-1 flex gap-2">
          {(
            [
              ["ADMIN", "Admin — full operational access"],
              ["FINANCE", "Finance — read-only money oversight"],
            ] as Array<["ADMIN" | "FINANCE", string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setRole(value)}
              className={`rounded-xl border px-3 py-2.5 text-sm transition ${
                role === value
                  ? "border-brand-300 bg-brand-50 font-semibold text-brand-800"
                  : "border-ink-100 bg-white text-ink-700 hover:border-ink-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between">
          <Label>Assign tabs & permissions</Label>
          <div className="flex gap-2">
            <button type="button" onClick={selectAll} className="text-xs font-medium text-brand-700 hover:underline">
              Select all
            </button>
            <span className="text-ink-300">|</span>
            <button type="button" onClick={clearAll} className="text-xs font-medium text-brand-700 hover:underline">
              Clear all
            </button>
          </div>
        </div>
        <p className="mb-3 text-xs text-ink-500">
          Leave empty to grant full access to all tabs. Select specific tabs to restrict.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {ASSIGNABLE_ADMIN_TABS.map((tab) => (
            <label
              key={tab.href}
              className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition ${
                selectedTabs.includes(tab.href)
                  ? "border-brand-300 bg-brand-50 text-brand-800"
                  : "border-ink-100 bg-white text-ink-700 hover:border-ink-200"
              }`}
            >
              <input
                type="checkbox"
                checked={selectedTabs.includes(tab.href)}
                onChange={() => toggleTab(tab.href)}
                className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
              />
              {tab.label}
            </label>
          ))}
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
        <Button type="submit" disabled={submitting}>
          <KeyRound className="h-4 w-4" />
          {submitting ? "Creating..." : "Generate password & create"}
        </Button>
      </div>
    </form>
  );
}

/* ----------------------------------------------------------------------- */

function NewMasterAdminForm({
  onCancel,
  onCreated
}: {
  onCancel: () => void;
  onCreated: (admin: MasterAdminRecord, password: string) => void;
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
      const password = generateRandomPassword(14);
      const res = await fetch("/api/admin/master-admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, phone, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create master admin");
      onCreated(data.masterAdmin, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50/60 to-white p-5"
    >
      <div className="mb-4 flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-white">
          <Star className="h-4 w-4" />
        </span>
        <div>
          <h3 className="font-display text-base font-semibold text-ink-900">
            New master admin
          </h3>
          <p className="text-xs text-ink-500">
            Create a new master admin. You can control which tabs they can access.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <Label htmlFor="madm-name">Full name</Label>
          <Input
            id="madm-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
          />
        </div>
        <div>
          <Label htmlFor="madm-email">Email</Label>
          <Input
            id="madm-email"
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="masteradmin@nxtgpay.com"
          />
        </div>
        <div>
          <Label htmlFor="madm-phone">Mobile</Label>
          <Input
            id="madm-phone"
            required
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+91 9XXXXXXXXX"
          />
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
        <strong>Note:</strong> Master admins always have full access to every tab and can
        create other admins and manage users. Only grant this level to fully trusted personnel.
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
        <Button type="submit" disabled={submitting}>
          <KeyRound className="h-4 w-4" />
          {submitting ? "Creating..." : "Generate password & create"}
        </Button>
      </div>
    </form>
  );
}

/* ----------------------------------------------------------------------- */

function EditTabsDialog({
  admin,
  onClose,
  onSaved
}: {
  admin: AdminRecord;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [selectedTabs, setSelectedTabs] = useState<string[]>(admin.allowedTabs);
  const [saving, setSaving] = useState(false);

  function toggleTab(href: string) {
    setSelectedTabs((prev) =>
      prev.includes(href) ? prev.filter((t) => t !== href) : [...prev, href]
    );
  }

  async function handleSave() {
    setSaving(true);
    await fetch(`/api/admin/admins/${admin.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update-tabs", allowedTabs: selectedTabs }),
    });
    setSaving(false);
    onSaved();
  }

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow="Edit permissions"
      title={admin.name}
      subtitle="Select tabs this admin can access. Empty = full access."
      headerClassName="bg-gradient-to-br from-violet-50 to-white"
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} isLoading={saving}>
            Save permissions
          </Button>
        </>
      }
    >
      <div className="mb-3 flex gap-2">
        <button
          type="button"
          onClick={() => setSelectedTabs(ASSIGNABLE_ADMIN_TABS.map((t) => t.href))}
          className="text-xs font-medium text-brand-700 hover:underline"
        >
          Select all
        </button>
        <span className="text-ink-300">|</span>
        <button
          type="button"
          onClick={() => setSelectedTabs([])}
          className="text-xs font-medium text-brand-700 hover:underline"
        >
          Clear all (full access)
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {ASSIGNABLE_ADMIN_TABS.map((tab) => (
          <label
            key={tab.href}
            className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition ${
              selectedTabs.includes(tab.href)
                ? "border-brand-300 bg-brand-50 text-brand-800"
                : "border-ink-100 bg-white text-ink-700 hover:border-ink-200"
            }`}
          >
            <input
              type="checkbox"
              checked={selectedTabs.includes(tab.href)}
              onChange={() => toggleTab(tab.href)}
              className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
            />
            {tab.label}
          </label>
        ))}
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------------------------- */

function CredentialsDialog({
  admin,
  password,
  isMaster,
  onClose
}: {
  admin: AdminRecord | MasterAdminRecord;
  password: string;
  isMaster: boolean;
  onClose: () => void;
}) {
  const [showPwd, setShowPwd] = useState(true);
  const [copied, setCopied] = useState<"none" | "email" | "pwd" | "both">("none");

  const roleLabel = isMaster ? "master admin" : "admin";
  const loginPath = isMaster ? "/master-admin" : "/admin";

  const copy = async (text: string, which: "email" | "pwd" | "both") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied("none"), 1800);
    } catch { /* ignore */ }
  };

  const both = `Login URL: ${typeof window !== "undefined" ? window.location.origin : ""}${loginPath}\nEmail: ${admin.email}\nPassword: ${password}`;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-900/40 px-4">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 bg-gradient-to-br from-emerald-50 to-white px-6 py-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">
              {isMaster ? "Master admin created" : "Admin created"}
            </p>
            <h3 className="mt-1 font-display text-lg font-bold text-ink-900">
              {admin.name}
            </h3>
            <p className="mt-1 text-xs text-ink-600">
              Share these credentials securely with the new {roleLabel}.
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
          <Field label="Login URL" value={loginPath} />
          <Field
            label="Email"
            value={admin.email}
            action={
              <button
                type="button"
                onClick={() => copy(admin.email, "email")}
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
            label="Password"
            mono
            value={showPwd ? password : "••••••••••••"}
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
            {" "}{roleLabel} via a secure channel.
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-ink-100 bg-ink-50/40 px-6 py-3">
          <Button variant="outline" onClick={() => copy(both, "both")}>
            {copied === "both" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            Copy all
          </Button>
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------- */

function ResetPasswordDialog({
  name,
  password,
  isMaster,
  onClose,
}: {
  name: string;
  password: string;
  isMaster: boolean;
  onClose: () => void;
}) {
  const [showPwd, setShowPwd] = useState(true);
  const [copied, setCopied] = useState(false);

  const roleLabel = isMaster ? "master admin" : "admin";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* ignore */ }
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
              A new password was generated for this {roleLabel}. All existing sessions
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
            value={showPwd ? password : "••••••••••••"}
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
            now and share it with the {roleLabel} via a secure channel.
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

/* ----------------------------------------------------------------------- */

function Field({
  label,
  value,
  mono,
  action
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
        <p className={`truncate text-sm text-ink-900 ${mono ? "font-mono" : "font-semibold"}`}>
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
  tone
}: {
  label: string;
  value: number;
  tone: "brand" | "success" | "warning";
}) {
  const map = {
    brand: "from-violet-600 to-violet-800 text-violet-50",
    success: "from-emerald-500 to-emerald-700 text-emerald-50",
    warning: "from-amber-500 to-amber-700 text-amber-50"
  };
  return (
    <div className={`rounded-2xl bg-gradient-to-br ${map[tone]} p-5 shadow-soft`}>
      <p className="text-xs font-bold uppercase tracking-widest opacity-90">{label}</p>
      <p className="mt-2 font-display text-3xl font-bold">{value}</p>
    </div>
  );
}
