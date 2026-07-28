"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import {
  UserPlus,
  Send,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Eye,
  ChevronDown,
  Search,
  RefreshCw,
  Pencil,
  FileText,
  Video,
  MapPin,
  ExternalLink,
  X,
  Link2,
  Copy,
  Share2,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input, Label, Select } from "@/components/ui/Input";
import { UplineChain } from "@/components/dashboard/UplineChain";

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "SUPER_DISTRIBUTOR", label: "Super Distributor" },
  { value: "MASTER_DISTRIBUTOR", label: "Master Distributor" },
  { value: "DISTRIBUTOR", label: "Distributor" },
  { value: "RETAILER", label: "Retailer" },
];

function getAllowedRoles(userRole: string): { value: string; label: string }[] {
  if (userRole === "MASTER_ADMIN") return ROLE_OPTIONS;
  if (userRole === "ADMIN") return ROLE_OPTIONS.filter((r) => r.value === "SUPER_DISTRIBUTOR");
  return ROLE_OPTIONS;
}

// Statuses where the onboarding link is still actionable (invitee can proceed).
const ACTIVE_LINK_STATUSES = ["PENDING", "REGISTERED", "VERIFIED"];

async function copyOnboardingLink(link: string) {
  try {
    await navigator.clipboard.writeText(link);
    toast.success("Onboarding link copied to clipboard");
  } catch {
    toast.error("Could not copy link");
  }
}

async function shareOnboardingLink(link: string, name?: string | null) {
  if (typeof navigator !== "undefined" && "share" in navigator) {
    try {
      await navigator.share({
        title: "NEXTGEN Onboarding",
        text: name ? `Onboarding link for ${name}` : "Complete your onboarding",
        url: link,
      });
      return;
    } catch {
      // User dismissed the share sheet or it's unavailable — fall back to copy.
    }
  }
  await copyOnboardingLink(link);
}

type Invite = {
  id: string;
  token: string;
  phone: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
  parentId: string | null;
  userCode: string | null;
  createdAt: string;
  expiresAt: string;
  registeredAt: string | null;
  verifiedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectedReason: string | null;
  upline?: { role: string; name: string; userCode: string | null }[];
  invitedBy?: { id: string; name: string; role: string; userCode: string | null } | null;
  onboardingLink?: string | null;
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  REGISTERED: "bg-blue-100 text-blue-800",
  VERIFIED: "bg-indigo-100 text-indigo-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-rose-100 text-rose-800",
  EXPIRED: "bg-gray-100 text-gray-600",
};

const DOC_TYPE_LABEL: Record<string, string> = {
  PAN: "PAN Card",
  AADHAAR_FRONT: "Aadhaar (Front)",
  AADHAAR_BACK: "Aadhaar (Back)",
  SHOP_PHOTO: "Shop Photo",
  BANK_PROOF: "Bank Proof",
  CANCEL_CHEQUE: "Cancelled Cheque / Passbook",
  PASSBOOK: "Bank Passbook",
  GST_CERT: "GST Certificate",
  SELFIE: "Live Selfie",
  LIVE_VIDEO: "Liveness Video",
  VIDEO: "Liveness Video",
  AGREEMENT: "Agreement",
  SHOP_ESTABLISHMENT: "Shop & Establishment Certificate",
  GUMASTA_LICENSE: "Gumasta License",
  SIGNATURE: "Signature",
  ELECTRICITY_BILL: "Electricity Bill",
  ADDITIONAL_ID: "Additional ID Proof",
  FAMILY_REFERENCE: "Family Reference Document",
  PG_FORM: "PG Form",
  GPS_PHOTO_OUTSIDE: "GPS Photo — Outside",
  GPS_PHOTO_INSIDE: "GPS Photo — Inside",
  GPS_SELFIE_DISTRIBUTOR: "GPS Selfie with Distributor",
  DISTRIBUTOR_DECLARATION: "Distributor Declaration",
  SELF_DECLARATION: "Self Declaration Form",
  SUCCESSOR_DECLARATION: "Successor Declaration",
  OTHER: "Other Document",
};

type OnboardDocument = {
  id: string;
  type: string;
  status: string;
  url: string | null;
  format: string | null;
  publicId: string | null;
  resourceType: string;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  createdAt: string;
};

export default function AdminInvitesPage() {
  const { data: session } = useSession();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedInvite, setSelectedInvite] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<any>(null);
  const [resending, setResending] = useState<string | null>(null);
  const [editingInvite, setEditingInvite] = useState<Invite | null>(null);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectBusy, setRejectBusy] = useState(false);

  const fetchInvites = useCallback(async () => {
    setLoading(true);
    const url = filter
      ? `/api/admin/invite?status=${filter}`
      : "/api/admin/invite";
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      setInvites(data.invites);
      setTotal(data.total);
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    fetchInvites();
  }, [fetchInvites]);

  async function viewDetail(id: string) {
    setSelectedInvite(id);
    const res = await fetch(`/api/admin/invite/${id}`);
    if (res.ok) {
      setDetailData(await res.json());
    }
  }

  async function handleAction(id: string, action: "approve" | "reject", reason?: string) {
    const res = await fetch(`/api/admin/invite/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, reason }),
    });
    if (res.ok) {
      toast.success(action === "approve" ? "Invite approved." : "Invite rejected.");
      fetchInvites();
      setSelectedInvite(null);
      setDetailData(null);
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error(typeof data?.error === "string" ? data.error : `Failed to ${action} invite`);
    }
  }

  async function handleResend(id: string) {
    setResending(id);
    try {
      const res = await fetch(`/api/admin/invite/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resend" }),
      });
      const data = await res.json();
      if (res.ok && data.emailSent) {
        toast.success("Onboarding email resent successfully!");
      } else if (res.ok && !data.emailSent) {
        toast.error(
          data.emailError
            ? `Email delivery failed: ${data.emailError}`
            : "Invite found but email delivery failed. Please check email provider settings."
        );
      } else {
        toast.error(data.error || "Failed to resend invite");
      }
    } catch {
      toast.error("Network error — could not resend invite");
    } finally {
      setResending(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="Onboarding Invites"
        description="Create and manage onboarding invites for any network role."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => setShowCreate(true)}>
          <UserPlus className="h-4 w-4" /> Create Invite
        </Button>
        <Select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-40"
        >
          <option value="">All Status</option>
          <option value="PENDING">Pending</option>
          <option value="REGISTERED">Registered</option>
          <option value="VERIFIED">Verified</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
        </Select>
        <span className="ml-auto text-sm text-ink-500">
          {total} invite{total !== 1 ? "s" : ""}
        </span>
      </div>

      {showCreate && (
        <CreateInviteForm
          userRole={(session?.user as any)?.role ?? "ADMIN"}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            fetchInvites();
          }}
        />
      )}

      {editingInvite && (
        <EditInviteForm
          invite={editingInvite}
          onClose={() => setEditingInvite(null)}
          onUpdated={() => {
            setEditingInvite(null);
            fetchInvites();
          }}
        />
      )}

      {selectedInvite && detailData && (
        <InviteDetail
          data={detailData}
          onClose={() => {
            setSelectedInvite(null);
            setDetailData(null);
          }}
          onAction={(action) => {
            if (action === "reject") setRejectTarget(selectedInvite);
            else handleAction(selectedInvite, action);
          }}
        />
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
        </div>
      ) : invites.length === 0 ? (
        <div className="rounded-2xl border border-ink-100 bg-white p-10 text-center">
          <p className="text-ink-500">No invites found.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-ink-100 bg-ink-50/50">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-ink-700">Contact</th>
                <th className="px-4 py-3 text-left font-semibold text-ink-700">Role</th>
                <th className="px-4 py-3 text-left font-semibold text-ink-700">Shared By</th>
                <th className="px-4 py-3 text-left font-semibold text-ink-700">Upline</th>
                <th className="px-4 py-3 text-left font-semibold text-ink-700">Status</th>
                <th className="px-4 py-3 text-left font-semibold text-ink-700">Created</th>
                <th className="px-4 py-3 text-right font-semibold text-ink-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-50">
              {invites.map((inv) => (
                <tr key={inv.id} className="hover:bg-ink-50/30">
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink-900">{inv.name || inv.email}</div>
                    <div className="text-xs text-ink-500">{inv.phone}</div>
                    {inv.userCode && (
                      <div className="mt-0.5 text-xs font-medium text-brand-600">{inv.userCode}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-700">
                    {inv.role.replace("_", " ")}
                  </td>
                  <td className="px-4 py-3">
                    {inv.invitedBy ? (
                      <div>
                        <div className="font-medium text-ink-900">{inv.invitedBy.name}</div>
                        <div className="text-xs text-ink-500">
                          {inv.invitedBy.role.replace(/_/g, " ")}
                          {inv.invitedBy.userCode ? ` · ${inv.invitedBy.userCode}` : ""}
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-ink-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <UplineChain nodes={inv.upline ?? []} />
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLORS[inv.status] ?? "bg-gray-100 text-gray-700"}`}>
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ink-500">
                    {new Date(inv.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {inv.onboardingLink && ACTIVE_LINK_STATUSES.includes(inv.status) && (
                        <>
                          <button
                            onClick={() => copyOnboardingLink(inv.onboardingLink!)}
                            title="Copy onboarding link"
                            className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-900"
                          >
                            <Link2 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => shareOnboardingLink(inv.onboardingLink!, inv.name)}
                            title="Share onboarding link"
                            className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-900"
                          >
                            <Share2 className="h-4 w-4" />
                          </button>
                        </>
                      )}
                      {inv.status === "PENDING" && (
                        <>
                          <button
                            onClick={() => setEditingInvite(inv)}
                            title="Edit mobile number or email"
                            className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-900"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleResend(inv.id)}
                            disabled={resending === inv.id}
                            title="Resend onboarding email"
                            className="rounded-lg p-1.5 text-brand-600 hover:bg-brand-50 disabled:opacity-50"
                          >
                            {resending === inv.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="h-4 w-4" />
                            )}
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => viewDetail(inv.id)}
                        className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-900"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      {(inv.status === "VERIFIED" || inv.status === "REGISTERED") && (
                        <>
                          <button
                            onClick={() => handleAction(inv.id, "approve")}
                            className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setRejectTarget(inv.id)}
                            className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-50"
                          >
                            <XCircle className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={rejectTarget !== null}
        onClose={() => setRejectTarget(null)}
        busy={rejectBusy}
        title="Reject this invite?"
        description="The applicant will be notified and cannot proceed with this invite."
        confirmLabel="Reject"
        input={{ label: "Rejection reason (optional)", placeholder: "e.g. Documents unclear" }}
        onConfirm={async (reason) => {
          if (!rejectTarget) return;
          setRejectBusy(true);
          try {
            await handleAction(rejectTarget, "reject", reason || undefined);
          } finally {
            setRejectBusy(false);
          }
          setRejectTarget(null);
        }}
      />
    </div>
  );
}

type ParentUser = {
  id: string;
  name: string;
  phone: string;
  shopName: string | null;
  city: string | null;
  state: string | null;
};

function CreateInviteForm({
  userRole,
  onClose,
  onCreated,
}: {
  userRole: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const allowedRoles = getAllowedRoles(userRole);
  const [form, setForm] = useState({
    phone: "",
    email: "",
    name: "",
    role: allowedRoles[0]?.value ?? "SUPER_DISTRIBUTOR",
    parentId: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [parents, setParents] = useState<ParentUser[]>([]);
  const [parentsLoading, setParentsLoading] = useState(false);
  const [parentSearch, setParentSearch] = useState("");

  const needsParent = userRole === "MASTER_ADMIN" && form.role !== "SUPER_DISTRIBUTOR";

  useEffect(() => {
    if (!needsParent) {
      setParents([]);
      setForm((f) => ({ ...f, parentId: "" }));
      return;
    }
    setParentsLoading(true);
    fetch(`/api/admin/invite/parents?role=${form.role}`)
      .then((r) => r.json())
      .then((data) => {
        setParents(data.parents ?? []);
        setForm((f) => ({ ...f, parentId: "" }));
      })
      .catch(() => setParents([]))
      .finally(() => setParentsLoading(false));
  }, [form.role, needsParent]);

  const filteredParents = parentSearch
    ? parents.filter(
        (p) =>
          p.name.toLowerCase().includes(parentSearch.toLowerCase()) ||
          p.phone.includes(parentSearch) ||
          (p.shopName ?? "").toLowerCase().includes(parentSearch.toLowerCase())
      )
    : parents;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (needsParent && !form.parentId) {
      setError("Please select a parent user to assign this invite under.");
      return;
    }

    setSubmitting(true);
    setError("");
    setSuccess("");

    const res = await fetch("/api/admin/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: form.phone.replace(/\s/g, ""),
        email: form.email,
        name: form.name || undefined,
        role: form.role,
        ...(form.parentId ? { parentId: form.parentId } : {}),
      }),
    });

    const data = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "Failed to create invite");
      return;
    }

    if (data.emailSent === false) {
      setError(
        data.emailError
          ? `Invite created, but email delivery failed: ${data.emailError}`
          : "Invite created, but email delivery failed. Please check email provider settings."
      );
    }
    setSuccess(`Invite created! Link: ${data.invite.onboardingLink}`);
    setTimeout(onCreated, 2000);
  }

  return (
    <div className="rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white p-6 shadow-soft">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-display text-lg font-bold text-ink-900">Create New Invite</h3>
        <button onClick={onClose} className="text-ink-400 hover:text-ink-700">✕</button>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
          {success}
        </div>
      )}

      <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
        <div>
          <Label>Mobile Number *</Label>
          <Input
            required
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            placeholder="+91 98765 43210"
          />
        </div>
        <div>
          <Label>Email *</Label>
          <Input
            required
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            placeholder="user@example.com"
          />
        </div>
        <div>
          <Label>Name (optional)</Label>
          <Input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Full name"
          />
        </div>
        <div>
          <Label>Role *</Label>
          {allowedRoles.length === 1 ? (
            <Input value={allowedRoles[0].label} disabled />
          ) : (
            <Select
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
            >
              {allowedRoles.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          )}
        </div>

        {needsParent && (
          <div className="md:col-span-2">
            <Label>
              Assign Under *{" "}
              <span className="text-xs font-normal text-ink-500">
                (Select the {form.role === "MASTER_DISTRIBUTOR" ? "Super Distributor" : form.role === "DISTRIBUTOR" ? "Master Distributor" : "Distributor"} this user will work under)
              </span>
            </Label>
            {parentsLoading ? (
              <div className="flex items-center gap-2 py-2 text-sm text-ink-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading...
              </div>
            ) : parents.length === 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700">
                No active {form.role === "MASTER_DISTRIBUTOR" ? "Super Distributors" : form.role === "DISTRIBUTOR" ? "Master Distributors" : "Distributors"} found. Create one first.
              </div>
            ) : (
              <>
                <div className="relative mt-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                  <Input
                    value={parentSearch}
                    onChange={(e) => setParentSearch(e.target.value)}
                    placeholder="Search by name, phone, or shop..."
                    className="pl-9"
                  />
                </div>
                <div className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-ink-200 bg-white">
                  {filteredParents.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-ink-500">No match found.</p>
                  ) : (
                    filteredParents.map((p) => (
                      <label
                        key={p.id}
                        className={`flex cursor-pointer items-center gap-3 border-b border-ink-50 px-4 py-2.5 last:border-b-0 hover:bg-brand-50/50 ${
                          form.parentId === p.id ? "bg-brand-50 ring-1 ring-inset ring-brand-300" : ""
                        }`}
                      >
                        <input
                          type="radio"
                          name="parentId"
                          value={p.id}
                          checked={form.parentId === p.id}
                          onChange={() => setForm((f) => ({ ...f, parentId: p.id }))}
                          className="h-4 w-4 text-brand-600 focus:ring-brand-500"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-ink-900">{p.name}</p>
                          <p className="truncate text-xs text-ink-500">
                            {p.phone}
                            {p.shopName ? ` · ${p.shopName}` : ""}
                            {p.city ? ` · ${p.city}` : ""}
                          </p>
                        </div>
                      </label>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        )}

        <div className="flex items-center gap-3 md:col-span-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send Invite
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

function EditInviteForm({
  invite,
  onClose,
  onUpdated,
}: {
  invite: Invite;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [form, setForm] = useState({
    phone: invite.phone,
    email: invite.email,
    name: invite.name ?? "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccess("");

    const res = await fetch(`/api/admin/invite/${invite.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update",
        phone: form.phone.replace(/\s/g, ""),
        email: form.email,
        ...(form.name ? { name: form.name } : {}),
      }),
    });

    const data = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "Failed to update invite");
      return;
    }

    setSuccess(
      data.emailSent
        ? "Invite updated and onboarding email sent to the new address!"
        : `Invite updated, but email delivery failed${data.emailError ? `: ${data.emailError}` : ""}. You can retry with the resend button.`
    );
    setTimeout(onUpdated, 2000);
  }

  return (
    <div className="rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white p-6 shadow-soft">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-display text-lg font-bold text-ink-900">
          Edit Invite — {invite.role.replace(/_/g, " ")}
        </h3>
        <button onClick={onClose} className="text-ink-400 hover:text-ink-700">✕</button>
      </div>

      <p className="mb-4 text-sm text-ink-500">
        Correct the mobile number or email if the invite was sent to the wrong
        contact. The onboarding link will be re-sent to the updated details.
      </p>

      {error && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
          {success}
        </div>
      )}

      <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
        <div>
          <Label>Mobile Number *</Label>
          <Input
            required
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            placeholder="+91 98765 43210"
          />
        </div>
        <div>
          <Label>Email *</Label>
          <Input
            required
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            placeholder="user@example.com"
          />
        </div>
        <div>
          <Label>Name (optional)</Label>
          <Input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Full name"
          />
        </div>
        <div className="flex items-end gap-3">
          <Button type="submit" disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Save & Resend
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

type DeclarationApprovalRow = {
  id: string;
  status: string;
  approverName: string | null;
  approverRole: string;
  onboardeeRole: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectedReason: string | null;
  approvalLatitude: number | null;
  approvalLongitude: number | null;
  approvalIp: string | null;
  approverSignatureUrl: string | null;
  approverSelfieUrl: string | null;
  hasDocument: boolean;
  sentAt: string;
};

function InviteDetail({
  data,
  onClose,
  onAction,
}: {
  data: {
    invite: Invite;
    invitedBy?: { id: string; name: string; role: string; userCode: string | null } | null;
    onboardingLink?: string | null;
    verifications: any[];
    documents?: OnboardDocument[];
    registeredUser: any;
    declarationApprovals?: DeclarationApprovalRow[];
  };
  onClose: () => void;
  onAction: (action: "approve" | "reject") => void;
}) {
  const { invite, invitedBy, onboardingLink, verifications, registeredUser } = data;
  const documents = data.documents ?? [];
  const declarationApprovals = data.declarationApprovals ?? [];
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);

  async function openVideo() {
    setVideoLoading(true);
    try {
      const res = await fetch(`/api/admin/invite/${invite.id}/video`);
      if (res.ok) {
        const data = await res.json();
        window.open(data.url, "_blank", "noopener,noreferrer");
      }
    } catch {}
    setVideoLoading(false);
  }

  return (
    <div className="rounded-2xl border border-ink-200 bg-white p-6 shadow-soft">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-display text-lg font-bold text-ink-900">
          Invite Details
        </h3>
        <button onClick={onClose} className="text-ink-400 hover:text-ink-700">✕</button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl bg-ink-50 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-ink-500">Contact</p>
          <p className="mt-1 font-semibold">{invite.name || "—"}</p>
          <p className="text-sm text-ink-600">{invite.email}</p>
          <p className="text-sm text-ink-600">{invite.phone}</p>
        </div>
        <div className="rounded-xl bg-ink-50 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-ink-500">Role & Status</p>
          <p className="mt-1 font-semibold">{invite.role.replace("_", " ")}</p>
          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLORS[invite.status]}`}>
            {invite.status}
          </span>
        </div>
        <div className="rounded-xl bg-ink-50 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-ink-500">Timeline</p>
          <p className="mt-1 text-sm">Created: {new Date(invite.createdAt).toLocaleString()}</p>
          {invite.registeredAt && <p className="text-sm">Registered: {new Date(invite.registeredAt).toLocaleString()}</p>}
          {invite.verifiedAt && <p className="text-sm">Verified: {new Date(invite.verifiedAt).toLocaleString()}</p>}
        </div>
      </div>

      {invitedBy && (
        <div className="mt-4 rounded-xl bg-ink-50 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-ink-500">Shared By</p>
          <p className="mt-1 font-semibold text-ink-900">{invitedBy.name}</p>
          <p className="text-sm text-ink-600">
            {invitedBy.role.replace(/_/g, " ")}
            {invitedBy.userCode ? ` · ${invitedBy.userCode}` : ""}
          </p>
        </div>
      )}

      {onboardingLink && (
        <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50/60 p-4">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-brand-700">
            <Link2 className="h-3.5 w-3.5" /> Onboarding Link
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-brand-200 bg-white px-3 py-2 text-xs text-ink-700">
              {onboardingLink}
            </code>
            <button
              type="button"
              onClick={() => copyOnboardingLink(onboardingLink)}
              className="inline-flex items-center gap-1 rounded-lg border border-brand-200 bg-white px-2.5 py-2 text-xs font-semibold text-brand-700 hover:bg-brand-50"
            >
              <Copy className="h-3.5 w-3.5" /> Copy
            </button>
            <button
              type="button"
              onClick={() => shareOnboardingLink(onboardingLink, invite.name)}
              className="inline-flex items-center gap-1 rounded-lg border border-brand-200 bg-white px-2.5 py-2 text-xs font-semibold text-brand-700 hover:bg-brand-50"
            >
              <Share2 className="h-3.5 w-3.5" /> Share
            </button>
            <a
              href={onboardingLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-brand-200 bg-white px-2.5 py-2 text-xs font-semibold text-brand-700 hover:bg-brand-50"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Open
            </a>
          </div>
          {!ACTIVE_LINK_STATUSES.includes(invite.status) && (
            <p className="mt-2 text-xs text-ink-500">
              This invite is {invite.status.toLowerCase()} — the link may no longer be usable.
            </p>
          )}
        </div>
      )}

      {verifications.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-sm font-bold text-ink-700">Verification Results</p>
          {(() => {
            const biz = verifications.find(
              (v: any) => v.type === "BUSINESS_NAME" && v.status === "Success"
            );
            const gst = verifications.find(
              (v: any) => v.type === "GST" && v.status === "Success"
            );
            const gstPayload = (gst?.responsePayload ?? {}) as any;
            const businessName =
              gstPayload?.trade_name ??
              gstPayload?.trade_name_of_business ??
              gstPayload?.legal_name ??
              gst?.verifiedName ??
              biz?.verifiedName ??
              null;
            if (!businessName) return null;
            return (
              <div className="mb-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3">
                <p className="text-xs font-bold uppercase tracking-wider text-brand-700">
                  Business / Shop Name
                </p>
                <p className="mt-1 font-semibold text-ink-900">{businessName}</p>
                <p className="text-xs text-ink-500">
                  {gst ? "From GST verification" : "Entered manually (GST not verified)"}
                </p>
              </div>
            );
          })()}
          <div className="space-y-2">
            {verifications.map((v: any) => {
              // "Success" = verified check, "Uploaded" = successful media/file
              // upload (e.g. ONBOARD VIDEO), "Pending" = awaiting completion
              // (e.g. eSign). Only genuine failures should show red.
              const tone =
                v.status === "Success" || v.status === "Uploaded"
                  ? "ok"
                  : v.status === "Pending"
                  ? "pending"
                  : "fail";
              return (
                <div
                  key={v.id}
                  className={`flex items-center justify-between rounded-xl border px-4 py-2 ${
                    tone === "ok"
                      ? "border-emerald-200 bg-emerald-50"
                      : tone === "pending"
                      ? "border-amber-200 bg-amber-50"
                      : "border-rose-200 bg-rose-50"
                  }`}
                >
                  <div>
                    <span className="font-medium">
                      {v.type === "BUSINESS_NAME"
                        ? "Business Name"
                        : v.type.replace(/_/g, " ")}
                    </span>
                    {v.verifiedName && (
                      <span className="ml-2 text-sm text-ink-600">— {v.verifiedName}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {v.type === "ONBOARD_VIDEO" && v.status === "Uploaded" && (
                      <button
                        type="button"
                        onClick={openVideo}
                        disabled={videoLoading}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                      >
                        {videoLoading ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Video className="h-3 w-3" />
                        )}
                        Open
                      </button>
                    )}
                    <span
                      className={`text-sm font-semibold ${
                        tone === "ok"
                          ? "text-emerald-700"
                          : tone === "pending"
                          ? "text-amber-700"
                          : "text-rose-700"
                      }`}
                    >
                      {tone === "ok"
                        ? v.status === "Uploaded"
                          ? "✓ Uploaded"
                          : "✓ Verified"
                        : tone === "pending"
                        ? "⏳ Pending"
                        : "✕ Failed"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {documents.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-sm font-bold text-ink-700">
            Uploaded Documents ({documents.length})
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {documents.map((doc) => {
              const isImage = doc.resourceType === "image" && doc.format !== "pdf";
              const isVideo = doc.resourceType === "video" || ["mp4", "webm", "mov"].includes(doc.format ?? "");
              const isPdf = doc.format === "pdf";
              const openHref = `/api/kyc/document/${doc.id}`;

              return (
                <div
                  key={doc.id}
                  className="group overflow-hidden rounded-xl border border-ink-200 bg-white transition hover:border-brand-300 hover:shadow-sm"
                >
                  {doc.url && isImage ? (
                    <button
                      type="button"
                      onClick={() => setLightbox(doc.url)}
                      className="relative block h-32 w-full overflow-hidden bg-ink-50"
                    >
                      <img
                        src={doc.url}
                        alt={DOC_TYPE_LABEL[doc.type] ?? doc.type}
                        className="h-full w-full object-contain transition group-hover:scale-[1.02]"
                        loading="lazy"
                      />
                    </button>
                  ) : isVideo ? (
                    <div className="flex h-32 w-full items-center justify-center bg-ink-900">
                      <Video className="h-8 w-8 text-white/60" />
                    </div>
                  ) : isPdf ? (
                    <a
                      href={openHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-24 w-full items-center justify-center bg-rose-50 transition hover:bg-rose-100"
                    >
                      <FileText className="h-7 w-7 text-rose-400" />
                      <span className="ml-2 text-xs font-bold uppercase text-rose-500">PDF</span>
                    </a>
                  ) : (
                    <div className="flex h-24 w-full items-center justify-center bg-ink-50">
                      <FileText className="h-7 w-7 text-ink-300" />
                    </div>
                  )}

                  <div className="p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-xs font-semibold text-ink-800">
                        {DOC_TYPE_LABEL[doc.type] ?? doc.type.replace(/_/g, " ")}
                      </p>
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-ink-500">
                      {doc.format && (
                        <span className="rounded bg-ink-100 px-1.5 py-0.5 font-medium uppercase">
                          {doc.format}
                        </span>
                      )}
                      {doc.gpsLatitude && doc.gpsLongitude && (
                        <a
                          href={`https://www.google.com/maps?q=${doc.gpsLatitude},${doc.gpsLongitude}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-0.5 font-medium text-amber-600 hover:underline"
                        >
                          <MapPin className="h-3 w-3" /> GPS
                        </a>
                      )}
                    </div>
                    <a
                      href={openHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
                    >
                      Open <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {declarationApprovals.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-sm font-bold text-ink-700">
            Successor Declaration Approval
          </p>
          <div className="space-y-3">
            {declarationApprovals.map((a) => {
              const tone =
                a.status === "APPROVED"
                  ? "ok"
                  : a.status === "PENDING"
                  ? "pending"
                  : "fail";
              return (
                <div
                  key={a.id}
                  className={`rounded-xl border px-4 py-3 ${
                    tone === "ok"
                      ? "border-emerald-200 bg-emerald-50"
                      : tone === "pending"
                      ? "border-amber-200 bg-amber-50"
                      : "border-rose-200 bg-rose-50"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-ink-900">
                        {a.approverName ?? "—"}{" "}
                        <span className="font-normal text-ink-500">
                          ({a.approverRole.replace(/_/g, " ")})
                        </span>
                      </p>
                      <p className="text-xs text-ink-500">
                        Responsible for {a.onboardeeRole.replace(/_/g, " ")} · Sent{" "}
                        {new Date(a.sentAt).toLocaleString()}
                      </p>
                    </div>
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        tone === "ok"
                          ? "bg-emerald-100 text-emerald-800"
                          : tone === "pending"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-rose-100 text-rose-800"
                      }`}
                    >
                      {a.status}
                    </span>
                  </div>

                  {a.status === "APPROVED" && (
                    <div className="mt-3 flex flex-wrap items-center gap-4">
                      {a.approverSelfieUrl && (
                        <a href={a.approverSelfieUrl} target="_blank" rel="noopener noreferrer">
                          <img
                            src={a.approverSelfieUrl}
                            alt="Approver selfie"
                            className="h-16 w-16 rounded-lg border border-ink-200 object-cover"
                          />
                        </a>
                      )}
                      {a.approverSignatureUrl && (
                        <a href={a.approverSignatureUrl} target="_blank" rel="noopener noreferrer">
                          <img
                            src={a.approverSignatureUrl}
                            alt="Approver signature"
                            className="h-16 w-28 rounded-lg border border-ink-200 bg-white object-contain p-1"
                          />
                        </a>
                      )}
                      <div className="text-xs text-ink-600">
                        {a.approvedAt && (
                          <p>Approved: {new Date(a.approvedAt).toLocaleString()}</p>
                        )}
                        {a.approvalIp && <p>IP: {a.approvalIp}</p>}
                        {a.approvalLatitude != null && a.approvalLongitude != null && (
                          <a
                            href={`https://www.google.com/maps?q=${a.approvalLatitude},${a.approvalLongitude}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 font-medium text-amber-600 hover:underline"
                          >
                            <MapPin className="h-3 w-3" /> {a.approvalLatitude.toFixed(5)},{" "}
                            {a.approvalLongitude.toFixed(5)}
                          </a>
                        )}
                      </div>
                      {a.hasDocument && (
                        <a
                          href={`/api/declarations/${a.id}/document`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
                        >
                          <FileText className="h-3 w-3" /> Signed Declaration
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  )}

                  {a.status === "REJECTED" && a.rejectedReason && (
                    <p className="mt-2 text-xs text-rose-700">
                      Reason: {a.rejectedReason}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {registeredUser && (
        <div className="mt-4 rounded-xl border border-ink-100 bg-ink-50/50 p-4">
          <p className="mb-1 text-sm font-bold text-ink-700">Registered User</p>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <p><span className="text-ink-500">Name:</span> {registeredUser.name}</p>
            <p><span className="text-ink-500">Shop:</span> {registeredUser.shopName ?? "—"}</p>
            <p><span className="text-ink-500">State:</span> {registeredUser.state ?? "—"}</p>
            <p><span className="text-ink-500">City:</span> {registeredUser.city ?? "—"}</p>
          </div>
        </div>
      )}

      {(invite.status === "VERIFIED" || invite.status === "REGISTERED") && (
        <div className="mt-4 flex items-center gap-3">
          <Button onClick={() => onAction("approve")}>
            <CheckCircle2 className="h-4 w-4" /> Approve
          </Button>
          <Button variant="outline" onClick={() => onAction("reject")}>
            <XCircle className="h-4 w-4" /> Reject
          </Button>
        </div>
      )}

      {lightbox && (
        <div
          className="fixed inset-0 z-[60] grid place-items-center bg-ink-900/80 p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
            onClick={() => setLightbox(null)}
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={lightbox}
            alt="Document preview"
            className="max-h-[88vh] max-w-[92vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
