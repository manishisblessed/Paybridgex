"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import {
  Loader2,
  Search,
  Eye,
  Copy,
  UserPlus,
  Phone,
  Mail,
  Store,
  MapPin,
  MessageSquare,
  Inbox,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input, Label, Select } from "@/components/ui/Input";
import {
  FilterBar,
  ModalShell,
  StatusPill,
  TableEmptyRow,
  TablePro,
  TableSkeletonRows,
  type PillTone,
} from "@/components/dashboard/ui";
import { Reveal } from "@/components/motion";
import {
  CreateInviteForm,
  type CreateInviteResult,
} from "@/components/admin/CreateInviteForm";

type JoinRequest = {
  id: string;
  name: string;
  phone: string;
  email: string;
  shopName: string | null;
  city: string | null;
  state: string | null;
  role: string;
  message: string | null;
  status: string;
  notes: string | null;
  inviteId: string | null;
  handledById: string | null;
  handledAt: string | null;
  createdAt: string;
};

const STATUS_OPTIONS = ["NEW", "CONTACTED", "INVITED", "CLOSED", "REJECTED"];

const STATUS_TONES: Record<string, PillTone> = {
  NEW: "warning",
  CONTACTED: "brand",
  INVITED: "violet",
  CLOSED: "neutral",
  REJECTED: "danger",
};

function fmtRole(role: string) {
  return role
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function AdminJoinRequestsPage() {
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selected, setSelected] = useState<JoinRequest | null>(null);
  const [converting, setConverting] = useState<JoinRequest | null>(null);
  const { data: session } = useSession();
  const sessionRole =
    (session?.user as { role?: string } | undefined)?.role ?? "";
  const canConvert = sessionRole === "MASTER_ADMIN" || sessionRole === "ADMIN";

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (filter) qs.set("status", filter);
    if (debouncedSearch) qs.set("q", debouncedSearch);
    const res = await fetch(`/api/admin/join-requests?${qs.toString()}`);
    if (res.ok) {
      const data = await res.json();
      setRequests(data.requests);
      setTotal(data.total);
      setStatusCounts(data.statusCounts ?? {});
    } else {
      toast.error("Could not load join requests");
    }
    setLoading(false);
  }, [filter, debouncedSearch]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  async function updateRequest(
    id: string,
    body: { status?: string; notes?: string; inviteId?: string }
  ) {
    const res = await fetch(`/api/admin/join-requests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      toast.success("Updated");
      setRequests((rs) => rs.map((r) => (r.id === id ? data.request : r)));
      setSelected((s) => (s && s.id === id ? data.request : s));
      fetchRequests();
    } else {
      toast.error(typeof data.error === "string" ? data.error : "Update failed");
    }
  }

  async function handleConverted(lead: JoinRequest, result: CreateInviteResult) {
    await updateRequest(lead.id, {
      status: "INVITED",
      inviteId: result.invite.id,
    });
    setConverting(null);
    setSelected(null);
    toast.success("Invite created — lead marked as Invited");
  }

  return (
    <div className="space-y-6">
      <Reveal distance={14} duration={0.4}>
        <PageHeader
          eyebrow="Admin"
          title="Join Requests"
          description="Leads from the public Join Form. Connect with each applicant and convert them into an onboarding invite."
        />
      </Reveal>

      <Reveal distance={16} duration={0.45}>
        <div className="space-y-6">
          <FilterBar>
            <Select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-44"
            >
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {fmtRole(s)}
                  {statusCounts[s] != null ? ` (${statusCounts[s]})` : ""}
                </option>
              ))}
            </Select>
            <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, phone, email, shop..."
                className="pl-9"
              />
            </div>
            <span className="ml-auto text-sm text-ink-500">
              {total} request{total !== 1 ? "s" : ""}
            </span>
          </FilterBar>

          <TablePro title="Join requests" dense>
            <table className="min-w-[860px]">
              <thead>
                <tr>
                  <th>Applicant</th>
                  <th>Interested as</th>
                  <th>Business</th>
                  <th>Status</th>
                  <th>Submitted</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <TableSkeletonRows rows={6} cols={6} />
                ) : requests.length === 0 ? (
                  <TableEmptyRow
                    colSpan={6}
                    icon={Inbox}
                    message="No join requests found."
                  />
                ) : (
                  requests.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <div className="font-medium text-ink-900">{r.name}</div>
                        <div className="text-xs text-ink-500">{r.phone}</div>
                        <div className="text-xs text-ink-500">{r.email}</div>
                      </td>
                      <td className="text-ink-700">{fmtRole(r.role)}</td>
                      <td className="text-ink-700">
                        <div>{r.shopName || "—"}</div>
                        <div className="text-xs text-ink-500">
                          {[r.city, r.state].filter(Boolean).join(", ") || "—"}
                        </div>
                      </td>
                      <td>
                        <StatusPill
                          status={r.status}
                          tone={STATUS_TONES[r.status] ?? "neutral"}
                        />
                      </td>
                      <td className="text-ink-500">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Select
                            value={r.status}
                            onChange={(e) =>
                              updateRequest(r.id, { status: e.target.value })
                            }
                            className="h-9 w-36"
                          >
                            {STATUS_OPTIONS.map((s) => (
                              <option key={s} value={s}>
                                {fmtRole(s)}
                              </option>
                            ))}
                          </Select>
                          <button
                            onClick={() => setSelected(r)}
                            title="View details"
                            className="grid h-8 w-8 place-items-center rounded-lg text-brand-700 hover:bg-brand-50"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </TablePro>
        </div>
      </Reveal>

      {selected && (
        <JoinRequestDetail
          request={selected}
          canConvert={canConvert}
          onConvert={() => {
            setConverting(selected);
            setSelected(null);
          }}
          onClose={() => setSelected(null)}
          onSave={updateRequest}
        />
      )}

      {converting && (
        <div className="fixed inset-0 z-[60] overflow-y-auto bg-ink-900/50 p-4 backdrop-blur-sm">
          <div className="mx-auto my-8 max-w-2xl">
            <CreateInviteForm
              userRole={sessionRole}
              title={`Create invite — ${converting.name}`}
              submitLabel="Create invite & mark invited"
              initial={{
                phone: converting.phone,
                email: converting.email,
                name: converting.name,
                role: converting.role,
              }}
              onClose={() => setConverting(null)}
              onCreated={(result) => handleConverted(converting, result)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function JoinRequestDetail({
  request,
  canConvert,
  onConvert,
  onClose,
  onSave,
}: {
  request: JoinRequest;
  canConvert: boolean;
  onConvert: () => void;
  onClose: () => void;
  onSave: (id: string, body: { status?: string; notes?: string }) => Promise<void>;
}) {
  const [status, setStatus] = useState(request.status);
  const [notes, setNotes] = useState(request.notes ?? "");
  const [saving, setSaving] = useState(false);

  async function copyDetails() {
    const text = [
      `Name: ${request.name}`,
      `Phone: ${request.phone}`,
      `Email: ${request.email}`,
      `Role: ${fmtRole(request.role)}`,
      request.shopName ? `Shop: ${request.shopName}` : null,
      [request.city, request.state].filter(Boolean).length
        ? `Location: ${[request.city, request.state].filter(Boolean).join(", ")}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Details copied");
    } catch {
      toast.error("Could not copy");
    }
  }

  async function save() {
    setSaving(true);
    try {
      await onSave(request.id, { status, notes });
    } finally {
      setSaving(false);
    }
  }

  const rows: { icon: typeof Phone; label: string; value: string | null }[] = [
    { icon: Phone, label: "Mobile", value: request.phone },
    { icon: Mail, label: "Email", value: request.email },
    { icon: Store, label: "Shop / Business", value: request.shopName },
    {
      icon: MapPin,
      label: "Location",
      value: [request.city, request.state].filter(Boolean).join(", ") || null,
    },
    { icon: MessageSquare, label: "Message", value: request.message },
  ];

  return (
    <ModalShell
      open
      onClose={onClose}
      eyebrow="Join request"
      title={request.name}
      subtitle={
        <>
          Interested as {fmtRole(request.role)} · Submitted{" "}
          {new Date(request.createdAt).toLocaleString()}
        </>
      }
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={copyDetails}>
              <Copy className="h-4 w-4" /> Copy details
            </Button>
            {request.status === "INVITED" && request.inviteId ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 ring-1 ring-violet-200/70">
                <UserPlus className="h-4 w-4" /> Invite created
              </span>
            ) : canConvert ? (
              <Button variant="outline" size="sm" onClick={onConvert}>
                <UserPlus className="h-4 w-4" /> Create invite
              </Button>
            ) : (
              <Link href="/dashboard/admin/invites">
                <Button variant="outline" size="sm">
                  <UserPlus className="h-4 w-4" /> Create invite
                </Button>
              </Link>
            )}
          </div>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save changes
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-2">
          {rows.map(({ icon: Icon, label, value }) => (
            <div key={label} className="flex items-start gap-3 text-sm">
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
              <span className="w-28 shrink-0 text-ink-500">{label}</span>
              <span className="min-w-0 flex-1 font-medium text-ink-800">
                {value || "—"}
              </span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="detail-status">Status</Label>
            <Select
              id="detail-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {fmtRole(s)}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div>
          <Label htmlFor="detail-notes">Internal notes</Label>
          <textarea
            id="detail-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Add a note for your team..."
            className="flex w-full rounded-xl border border-ink-200 bg-white px-4 py-2.5 text-sm text-ink-900 shadow-sm transition placeholder:text-ink-400 focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-100"
          />
        </div>
      </div>
    </ModalShell>
  );
}
