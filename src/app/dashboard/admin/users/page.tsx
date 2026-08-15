"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import {
  Search,
  Filter,
  MoreHorizontal,
  ShieldOff,
  ShieldCheck,
  RefreshCw,
  Loader2,
  Power,
  X,
  BookOpen,
  Network,
  Copy,
  Ban,
  KeyRound,
  Eye,
  EyeOff,
  ClipboardCopy,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Input, Select } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ReportActions } from "@/components/dashboard/ReportActions";
import { Pagination } from "@/components/ui/Pagination";
import { UplineChain } from "@/components/dashboard/UplineChain";
import { formatINR } from "@/lib/utils";

type UserRow = {
  id: string;
  userCode: string;
  name: string;
  shop: string;
  role: "retailer" | "distributor" | "master-distributor" | "super-distributor";
  city: string;
  state: string;
  joined: string;
  status: "Active" | "Pending KYC" | "Suspended" | "Closed";
  walletBalance: number;
  monthlyTurnover: number;
  retailers: number;
  upline: { role: string; name: string; userCode: string | null }[];
};

export default function AdminUsersPage() {
  const [q, setQ] = useState("");
  const [role, setRole] = useState("all");
  const [status, setStatus] = useState("all");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [servicesUser, setServicesUser] = useState<UserRow | null>(null);
  const [moreUser, setMoreUser] = useState<UserRow | null>(null);
  const [closeTarget, setCloseTarget] = useState<UserRow | null>(null);
  const [statusTarget, setStatusTarget] = useState<UserRow | null>(null);
  const [resetPwUser, setResetPwUser] = useState<UserRow | null>(null);
  const [resetPwResult, setResetPwResult] = useState<{ user: UserRow; password: string } | null>(null);
  const [resettingPw, setResettingPw] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const notify = useCallback((text: string, ok: boolean) => {
    if (ok) toast.success(text);
    else toast.error(text);
  }, []);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (role !== "all") params.set("role", role);
      if (status !== "all") params.set("status", status);
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      const res = await fetch(`/api/admin/users?${params}`);
      const data = await res.json();
      if (data.users) {
        setUsers(data.users);
        setTotal(data.total ?? data.users.length);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [q, role, status, page]);

  useEffect(() => {
    setPage(1);
  }, [q, role, status]);

  useEffect(() => {
    const t = setTimeout(fetchUsers, 300);
    return () => clearTimeout(t);
  }, [fetchUsers]);

  async function toggleStatus(userId: string, currentStatus: string) {
    setActing(userId);
    try {
      const action = currentStatus === "Active" ? "suspend" : "activate";
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) fetchUsers();
    } catch {
      // silent
    } finally {
      setActing(null);
    }
  }

  async function closeAccount(user: UserRow) {
    setActing(user.id);
    setMoreUser(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close", reason: "Closed by admin from Users" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Close failed");
      notify(`${user.name} closed.`, true);
      fetchUsers();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Close failed", false);
    } finally {
      setActing(null);
    }
  }

  async function resetPassword(user: UserRow) {
    setResettingPw(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resetPassword" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Reset failed");
      setResetPwUser(null);
      setResetPwResult({ user, password: data.password });
      notify("Password reset successfully", true);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Reset failed", false);
    } finally {
      setResettingPw(false);
    }
  }

  function toggleSelected(userId: string) {
    setSelected((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  }

  const columns: Column<UserRow>[] = [
    {
      key: "select",
      header: "",
      align: "center",
      render: (r) => (
        <input
          type="checkbox"
          checked={selected.includes(r.id)}
          onChange={() => toggleSelected(r.id)}
          onClick={(e) => e.stopPropagation()}
          className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
          aria-label={`Select ${r.name}`}
        />
      ),
    },
    {
      key: "name",
      header: "User",
      render: (r) => (
        <div>
          <div className="font-semibold text-ink-900">{r.name}</div>
          <div className="text-xs text-ink-500">{r.shop} · <span className="font-medium text-brand-600">{r.userCode}</span></div>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      render: (r) => (
        <Badge variant={r.role === "super-distributor" ? "warning" : r.role === "master-distributor" ? "accent" : r.role === "distributor" ? "brand" : "default"}>
          {r.role}
        </Badge>
      ),
    },
    {
      key: "upline",
      header: "Upline",
      render: (r) => <UplineChain nodes={r.upline ?? []} />,
    },
    { key: "city", header: "Location", render: (r) => `${r.city}, ${r.state}` },
    { key: "joined", header: "Joined" },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <Badge variant={r.status === "Active" ? "success" : r.status === "Pending KYC" ? "warning" : "danger"}>
          {r.status}
        </Badge>
      ),
    },
    { key: "walletBalance", header: "Wallet", align: "right", render: (r) => formatINR(r.walletBalance) },
    { key: "monthlyTurnover", header: "MTD", align: "right", render: (r) => formatINR(r.monthlyTurnover) },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (r) => (
        <div className="flex justify-end gap-1">
          <button
            onClick={() => setServicesUser(r)}
            className="grid h-8 w-8 place-items-center rounded-lg text-violet-700 hover:bg-violet-50"
            title="Manage services"
          >
            <Power className="h-4 w-4" />
          </button>
          {acting === r.id ? (
            <Loader2 className="h-4 w-4 animate-spin text-ink-400" />
          ) : r.status === "Active" ? (
            <button
              onClick={() => toggleStatus(r.id, r.status)}
              className="grid h-8 w-8 place-items-center rounded-lg text-rose-700 hover:bg-rose-50"
              title="Suspend"
            >
              <ShieldOff className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={() => toggleStatus(r.id, r.status)}
              className="grid h-8 w-8 place-items-center rounded-lg text-emerald-700 hover:bg-emerald-50"
              title="Reactivate"
            >
              <ShieldCheck className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMoreUser(r);
            }}
            className="grid h-8 w-8 place-items-center rounded-lg text-ink-500 hover:bg-ink-100"
            title="More"
            aria-label={`More actions for ${r.name}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="Users & shops"
        description="Search, filter and manage every retailer, distributor and master across the platform."
        actions={
          <>
            <ReportActions
              filename="users"
              title="Paybridgex · Users & Shops"
              subtitle={`${users.length} users`}
              columns={[
                { key: "id", header: "ID" },
                { key: "name", header: "Name" },
                { key: "shop", header: "Shop / Firm" },
                { key: "role", header: "Role" },
                { key: "city", header: "City" },
                { key: "state", header: "State" },
                { key: "joined", header: "Joined" },
                { key: "status", header: "Status" },
                { key: "walletBalance", header: "Wallet (INR)" },
                { key: "monthlyTurnover", header: "MTD Turnover (INR)" },
              ]}
              rows={users}
            />
            <Button variant="outline" onClick={fetchUsers} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-ink-100 bg-white p-4">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input
            placeholder="Search name, shop, city..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-ink-400" />
          <Select value={role} onChange={(e) => setRole(e.target.value)} className="h-10 w-44">
            <option value="all">All roles</option>
            <option value="retailer">Retailers</option>
            <option value="distributor">Distributors</option>
            <option value="master-distributor">Master distributors</option>
            <option value="super-distributor">Super distributors</option>
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 w-44">
            <option value="all">Any status</option>
            <option value="Active">Active</option>
            <option value="Pending KYC">Pending KYC</option>
            <option value="Suspended">Suspended</option>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-ink-100 bg-white px-4 py-3">
        <p className="text-sm text-ink-700">
          <span className="font-semibold">{selected.length}</span> selected
        </p>
        <button
          type="button"
          onClick={() => setSelected(users.map((u) => u.id))}
          className="text-xs font-medium text-brand-700 hover:underline"
          disabled={users.length === 0}
        >
          Select all visible
        </button>
        <button
          type="button"
          onClick={() => setSelected([])}
          className="text-xs font-medium text-ink-500 hover:underline"
          disabled={selected.length === 0}
        >
          Clear
        </button>
        <div className="ml-auto">
          <Button
            variant="outline"
            onClick={() => setBulkOpen(true)}
            disabled={selected.length === 0}
          >
            <Power className="mr-2 h-4 w-4" />
            Bulk services ({selected.length})
          </Button>
        </div>
      </div>

      <DataTable
        title={`${total} users`}
        description="Click on a row to view full profile, ledger and transactions."
        columns={columns}
        data={users}
        loading={loading}
        empty="No users match your filters."
      />
      <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />

      {servicesUser && (
        <UserServicesDialog
          userId={servicesUser.id}
          userName={servicesUser.name}
          onClose={() => setServicesUser(null)}
        />
      )}

      {moreUser && (
        <UserMoreMenu
          user={moreUser}
          onClose={() => setMoreUser(null)}
          onManageServices={() => {
            setServicesUser(moreUser);
            setMoreUser(null);
          }}
          onResetPassword={() => {
            setResetPwUser(moreUser);
            setMoreUser(null);
          }}
          onCloseAccount={() => {
            setCloseTarget(moreUser);
            setMoreUser(null);
          }}
          onSetStatus={() => {
            setStatusTarget(moreUser);
            setMoreUser(null);
          }}
          onCopied={() => {
            notify("User ID copied", true);
            setMoreUser(null);
          }}
        />
      )}

      {statusTarget && (
        <ApprovalStatusDialog
          user={statusTarget}
          onClose={() => setStatusTarget(null)}
          onDone={(msg) => {
            notify(msg, true);
            setStatusTarget(null);
            fetchUsers();
          }}
          onError={(msg) => notify(msg, false)}
        />
      )}

      {bulkOpen && (
        <BulkServicesDialog
          userIds={selected}
          onClose={() => setBulkOpen(false)}
          onDone={() => {
            setBulkOpen(false);
            setSelected([]);
            fetchUsers();
          }}
        />
      )}

      <ConfirmDialog
        open={closeTarget !== null}
        onClose={() => setCloseTarget(null)}
        busy={closeTarget !== null && acting === closeTarget.id}
        title={closeTarget ? `Close account for ${closeTarget.name}?` : "Close account?"}
        description="This permanently marks the user as Closed and ends their sessions."
        confirmLabel="Close account"
        onConfirm={async () => {
          if (!closeTarget) return;
          await closeAccount(closeTarget);
          setCloseTarget(null);
        }}
      />

      <ConfirmDialog
        open={resetPwUser !== null}
        onClose={() => setResetPwUser(null)}
        busy={resettingPw}
        title={resetPwUser ? `Reset password for ${resetPwUser.name}?` : "Reset password?"}
        description="This generates a new random password and immediately signs the user out of all sessions. You will see the new password once — share it securely."
        confirmLabel="Reset password"
        onConfirm={async () => {
          if (!resetPwUser) return;
          await resetPassword(resetPwUser);
        }}
      />

      {resetPwResult && (
        <ResetPasswordResultDialog
          userName={resetPwResult.user.name}
          password={resetPwResult.password}
          onClose={() => setResetPwResult(null)}
        />
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------- */

function UserMoreMenu({
  user,
  onClose,
  onManageServices,
  onResetPassword,
  onCloseAccount,
  onSetStatus,
  onCopied,
}: {
  user: UserRow;
  onClose: () => void;
  onManageServices: () => void;
  onResetPassword: () => void;
  onCloseAccount: () => void;
  onSetStatus: () => void;
  onCopied: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copyId() {
    try {
      await navigator.clipboard.writeText(user.userCode || user.id);
      onCopied();
    } catch {
      onCopied();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink-900/40 px-4"
      onClick={onClose}
    >
      <div
        role="menu"
        aria-label={`More actions for ${user.name}`}
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-ink-100 px-5 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-ink-500">More actions</p>
            <h3 className="mt-1 truncate font-display text-base font-bold text-ink-900">{user.name}</h3>
            <p className="truncate text-xs text-ink-500">
              {user.shop} · {user.role}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-500 hover:bg-ink-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-2">
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-ink-800 transition hover:bg-ink-50"
            onClick={onManageServices}
          >
            <Power className="h-4 w-4 text-ink-500" />
            Manage services
          </button>
          <Link
            href={`/dashboard/admin/ledger?userId=${encodeURIComponent(user.id)}&q=${encodeURIComponent(user.name)}`}
            role="menuitem"
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-ink-800 transition hover:bg-ink-50"
            onClick={onClose}
          >
            <BookOpen className="h-4 w-4 text-ink-500" />
            View ledger
          </Link>
          <Link
            href={`/dashboard/admin/network?q=${encodeURIComponent(user.name)}`}
            role="menuitem"
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-ink-800 transition hover:bg-ink-50"
            onClick={onClose}
          >
            <Network className="h-4 w-4 text-ink-500" />
            Open in Network Manager
          </Link>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-ink-800 transition hover:bg-ink-50"
            onClick={copyId}
          >
            <Copy className="h-4 w-4 text-ink-500" />
            Copy user ID
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-ink-800 transition hover:bg-ink-50"
            onClick={onSetStatus}
          >
            <ShieldCheck className="h-4 w-4 text-ink-500" />
            Set approval status
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-amber-700 transition hover:bg-amber-50"
            onClick={onResetPassword}
          >
            <KeyRound className="h-4 w-4" />
            Reset password
          </button>

          {user.status !== "Closed" && (
            <button
              type="button"
              role="menuitem"
              className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-rose-700 transition hover:bg-rose-50"
              onClick={onCloseAccount}
            >
              <Ban className="h-4 w-4" />
              Close account
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------- */

type ApprovalTarget = "APPROVED" | "PENDING" | "REJECTED";

const APPROVAL_CHOICES: { target: ApprovalTarget; label: string; on: string }[] = [
  { target: "APPROVED", label: "Approved", on: "border-emerald-300 bg-emerald-50 text-emerald-700" },
  { target: "PENDING", label: "Pending", on: "border-amber-300 bg-amber-50 text-amber-700" },
  { target: "REJECTED", label: "Rejected", on: "border-rose-300 bg-rose-50 text-rose-700" },
];

function displayStatusToApproval(status: string): ApprovalTarget {
  if (status === "Active") return "APPROVED";
  if (status === "Suspended" || status === "Closed") return "REJECTED";
  return "PENDING";
}

function ApprovalStatusDialog({
  user,
  onClose,
  onDone,
  onError,
}: {
  user: UserRow;
  onClose: () => void;
  onDone: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const current = displayStatusToApproval(user.status);
  const [target, setTarget] = useState<ApprovalTarget>(current);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const dirty = target !== current;
  const needsReason = target === "REJECTED";

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function apply() {
    if (needsReason && reason.trim().length < 3) {
      onError("A reason is required to reject an account (min 3 characters).");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "setApprovalStatus",
          target,
          reason: reason.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Update failed");
      onDone(
        target === "APPROVED"
          ? `${user.name} approved — account is active.`
          : target === "REJECTED"
          ? `${user.name} rejected — login & transactions blocked.`
          : `${user.name} moved to pending review.`
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-900/40 px-4" onClick={onClose}>
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-ink-100 px-5 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-ink-500">Approval status</p>
            <h3 className="mt-1 truncate font-display text-base font-bold text-ink-900">{user.name}</h3>
            <p className="truncate text-xs text-ink-500">
              {user.role} · <span className="font-medium text-brand-600">{user.userCode}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-500 hover:bg-ink-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          <div className="mb-3 flex items-center justify-between text-sm">
            <span className="text-ink-500">Current</span>
            <Badge variant={current === "APPROVED" ? "success" : current === "REJECTED" ? "danger" : "warning"}>
              {APPROVAL_CHOICES.find((c) => c.target === current)?.label}
            </Badge>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {APPROVAL_CHOICES.map((c) => (
              <button
                key={c.target}
                type="button"
                disabled={busy}
                onClick={() => setTarget(c.target)}
                className={`rounded-xl border px-3 py-2 text-xs font-semibold transition disabled:opacity-60 ${
                  target === c.target ? c.on : "border-ink-200 text-ink-500 hover:border-ink-300"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          {needsReason && (
            <input
              type="text"
              placeholder="Reason for rejection (required)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-3 w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            />
          )}

          <p className="mt-3 text-[11px] leading-relaxed text-ink-400">
            Change the status in any direction. <b>Rejected</b> fully locks the account —
            no login and no transactions — and signs the user out immediately.
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-ink-100 bg-ink-50/40 px-5 py-3">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={apply}
            disabled={!dirty || busy || (needsReason && reason.trim().length < 3)}
            isLoading={busy}
          >
            Update status
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------- */

function ResetPasswordResultDialog({
  userName,
  password,
  onClose,
}: {
  userName: string;
  password: string;
  onClose: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copyPw() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-900/40 px-4">
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-ink-100 bg-gradient-to-br from-amber-50 to-white px-5 py-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700">
            Password reset
          </p>
          <h3 className="mt-1 font-display text-base font-bold text-ink-900">{userName}</h3>
          <p className="mt-1 text-xs text-ink-500">
            Share this password securely. It will not be shown again.
          </p>
        </div>

        <div className="px-5 py-4">
          <label className="text-xs font-bold uppercase tracking-widest text-ink-500">
            New password
          </label>
          <div className="mt-2 flex items-center gap-2 rounded-xl border border-ink-200 bg-ink-50 px-3 py-2.5">
            <code className="flex-1 text-sm font-semibold tracking-wide text-ink-900">
              {visible ? password : "••••••••••••"}
            </code>
            <button
              type="button"
              onClick={() => setVisible((v) => !v)}
              className="grid h-7 w-7 place-items-center rounded-lg text-ink-500 hover:bg-ink-200"
              title={visible ? "Hide" : "Show"}
            >
              {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={copyPw}
              className="grid h-7 w-7 place-items-center rounded-lg text-ink-500 hover:bg-ink-200"
              title="Copy"
            >
              <ClipboardCopy className="h-3.5 w-3.5" />
            </button>
          </div>
          {copied && (
            <p className="mt-1.5 text-xs font-medium text-emerald-600">Copied to clipboard</p>
          )}
        </div>

        <div className="flex justify-end border-t border-ink-100 bg-ink-50/40 px-5 py-3">
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------- */

type ServiceItem = {
  id: string;
  key: string;
  name: string;
  kind: string;
  enabled: boolean;
};

function UserServicesDialog({
  userId,
  userName,
  onClose,
}: {
  userId: string;
  userName: string;
  onClose: () => void;
}) {
  const [allServices, setAllServices] = useState<ServiceItem[]>([]);
  const [enabledKeys, setEnabledKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const notify = useCallback((text: string, ok: boolean) => {
    if (ok) toast.success(text);
    else toast.error(text);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/users/${userId}/services`);
        const data = await res.json();
        if (res.ok) {
          const services: ServiceItem[] = data.allServices ?? [];
          setAllServices(services);
          const userKeys: string[] = data.enabledServices ?? [];
          setEnabledKeys(userKeys.length === 0 ? services.map((s) => s.key) : userKeys);
        }
      } catch {
        notify("Failed to load services", false);
      } finally {
        setLoading(false);
      }
    })();
  }, [userId, notify]);

  function toggleService(key: string) {
    setEnabledKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  function enableAll() {
    setEnabledKeys(allServices.map((s) => s.key));
  }

  function disableAll() {
    setEnabledKeys([]);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const allEnabled = enabledKeys.length === allServices.length;
      const res = await fetch(`/api/admin/users/${userId}/services`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabledServices: allEnabled ? [] : enabledKeys }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Update failed");
      notify("Services updated successfully!", true);
      setTimeout(onClose, 1200);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed to save", false);
    } finally {
      setSaving(false);
    }
  }

  const grouped = useMemo(() => {
    const map = new Map<string, ServiceItem[]>();
    for (const s of allServices) {
      const arr = map.get(s.kind) ?? [];
      arr.push(s);
      map.set(s.kind, arr);
    }
    return Array.from(map.entries());
  }, [allServices]);

  const enabledCount = enabledKeys.length;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-900/40 px-4">
      <div className="w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-2xl flex flex-col">
        <div className="flex items-start justify-between gap-4 bg-gradient-to-br from-violet-50 to-white px-6 py-5 shrink-0">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-violet-700">
              Manage services
            </p>
            <h3 className="mt-1 font-display text-lg font-bold text-ink-900">
              {userName}
            </h3>
            <p className="mt-1 text-xs text-ink-600">
              All services are ON by default. Untick to restrict specific services for this user.
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

        <div className="overflow-y-auto flex-1 px-6 py-4">
          {loading ? (
            <div className="text-center text-sm text-ink-500 py-10">Loading services…</div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-ink-700">
                  <span className="font-semibold text-emerald-700">{enabledCount}</span> of{" "}
                  <span className="font-semibold">{allServices.length}</span> services enabled
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={enableAll}
                    className="text-xs font-medium text-emerald-700 hover:underline"
                  >
                    Enable all
                  </button>
                  <span className="text-ink-300">|</span>
                  <button
                    type="button"
                    onClick={disableAll}
                    className="text-xs font-medium text-rose-700 hover:underline"
                  >
                    Disable all
                  </button>
                </div>
              </div>

              <div className="space-y-5">
                {grouped.map(([kind, items]) => (
                  <div key={kind}>
                    <h4 className="text-xs font-bold uppercase tracking-widest text-ink-500 mb-2">
                      {kind}
                    </h4>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {items.map((svc) => {
                        const isEnabled = enabledKeys.includes(svc.key);
                        const isGloballyOff = !svc.enabled;
                        return (
                          <label
                            key={svc.key}
                            className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition ${
                              isGloballyOff
                                ? "border-ink-100 bg-ink-50 text-ink-400 cursor-not-allowed"
                                : isEnabled
                                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                : "border-ink-200 bg-white text-ink-600"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isEnabled}
                              disabled={isGloballyOff}
                              onChange={() => toggleService(svc.key)}
                              className="h-4 w-4 rounded border-ink-300 text-emerald-600 focus:ring-emerald-500"
                            />
                            <span className="flex-1 truncate">{svc.name}</span>
                            {isGloballyOff && (
                              <Badge variant="danger">Global OFF</Badge>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-ink-100 bg-ink-50/40 px-6 py-3 shrink-0">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || loading} isLoading={saving}>
            Save services
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------- */

function BulkServicesDialog({
  userIds,
  onClose,
  onDone,
}: {
  userIds: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [allServices, setAllServices] = useState<ServiceItem[]>([]);
  const [pickedKeys, setPickedKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"enable" | "disable" | null>(null);
  const notify = useCallback((text: string, ok: boolean) => {
    if (ok) toast.success(text);
    else toast.error(text);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/services`);
        const data = await res.json();
        if (res.ok) {
          const items: ServiceItem[] = (data.services ?? data.routes ?? []).filter(
            (s: ServiceItem & { type?: string }) => (s.type ?? "SERVICE") === "SERVICE"
          );
          setAllServices(items);
        }
      } catch {
        notify("Failed to load services", false);
      } finally {
        setLoading(false);
      }
    })();
  }, [notify]);

  function togglePicked(key: string) {
    setPickedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  async function apply(action: "enable" | "disable") {
    setSaving(action);
    try {
      const res = await fetch(`/api/admin/users/services/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds, serviceKeys: pickedKeys, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "Update failed");
      notify(
        `${action === "enable" ? "Enabled" : "Disabled"} ${pickedKeys.length} service(s) for ${data.updated} user(s).`,
        true
      );
      setTimeout(onDone, 1200);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed to save", false);
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-900/40 px-4">
      <div className="w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-2xl flex flex-col">
        <div className="flex items-start justify-between gap-4 bg-gradient-to-br from-brand-50 to-white px-6 py-5 shrink-0">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-brand-700">
              Bulk manage services
            </p>
            <h3 className="mt-1 font-display text-lg font-bold text-ink-900">
              {userIds.length} user{userIds.length === 1 ? "" : "s"} selected
            </h3>
            <p className="mt-1 text-xs text-ink-600">
              Pick services, then enable or disable them for every selected user in one go.
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

        <div className="overflow-y-auto flex-1 px-6 py-4">
          {loading ? (
            <div className="text-center text-sm text-ink-500 py-10">Loading services…</div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-ink-700">
                  <span className="font-semibold text-brand-700">{pickedKeys.length}</span> of{" "}
                  <span className="font-semibold">{allServices.length}</span> services picked
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPickedKeys(allServices.map((s) => s.key))}
                    className="text-xs font-medium text-brand-700 hover:underline"
                  >
                    Pick all
                  </button>
                  <span className="text-ink-300">|</span>
                  <button
                    type="button"
                    onClick={() => setPickedKeys([])}
                    className="text-xs font-medium text-ink-500 hover:underline"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {allServices.map((svc) => {
                  const picked = pickedKeys.includes(svc.key);
                  return (
                    <label
                      key={svc.key}
                      className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition ${
                        picked
                          ? "border-brand-200 bg-brand-50 text-brand-800"
                          : "border-ink-200 bg-white text-ink-600"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={picked}
                        onChange={() => togglePicked(svc.key)}
                        className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                      />
                      <span className="flex-1 truncate">{svc.name}</span>
                      {!svc.enabled && <Badge variant="danger">Global OFF</Badge>}
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-ink-100 bg-ink-50/40 px-6 py-3 shrink-0">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => apply("disable")}
            disabled={saving !== null || loading || pickedKeys.length === 0}
          >
            {saving === "disable" ? "Disabling..." : "Disable for selected"}
          </Button>
          <Button
            onClick={() => apply("enable")}
            disabled={saving !== null || loading || pickedKeys.length === 0}
          >
            {saving === "enable" ? "Enabling..." : "Enable for selected"}
          </Button>
        </div>
      </div>
    </div>
  );
}
