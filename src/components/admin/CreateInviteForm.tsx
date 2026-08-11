"use client";

import { useState, useEffect } from "react";
import { Loader2, Send, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Label, Select } from "@/components/ui/Input";

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "SUPER_DISTRIBUTOR", label: "Super Distributor" },
  { value: "MASTER_DISTRIBUTOR", label: "Master Distributor" },
  { value: "DISTRIBUTOR", label: "Distributor" },
  { value: "RETAILER", label: "Retailer" },
];

export function getAllowedRoles(
  userRole: string
): { value: string; label: string }[] {
  if (userRole === "MASTER_ADMIN") return ROLE_OPTIONS;
  if (userRole === "ADMIN") return ROLE_OPTIONS.filter((r) => r.value === "SUPER_DISTRIBUTOR");
  return ROLE_OPTIONS;
}

type ParentUser = {
  id: string;
  name: string;
  phone: string;
  shopName: string | null;
  city: string | null;
  state: string | null;
};

export type CreateInviteResult = {
  invite: { id: string; token: string; onboardingLink: string };
  emailSent?: boolean;
  emailError?: string;
};

/**
 * Shared "create onboarding invite" form. Used both from the Onboarding Invites
 * page and when converting a public Join Request into an invite. `initial`
 * pre-fills the contact/role (e.g. from a lead); `onCreated` receives the API
 * response so callers can chain follow-up actions (e.g. mark a lead INVITED).
 */
export function CreateInviteForm({
  userRole,
  initial,
  title = "Create New Invite",
  submitLabel = "Send Invite",
  onClose,
  onCreated,
}: {
  userRole: string;
  initial?: { phone?: string; email?: string; name?: string; role?: string };
  title?: string;
  submitLabel?: string;
  onClose: () => void;
  onCreated: (result: CreateInviteResult) => void;
}) {
  const allowedRoles = getAllowedRoles(userRole);
  const initialRole =
    initial?.role && allowedRoles.some((r) => r.value === initial.role)
      ? initial.role
      : allowedRoles[0]?.value ?? "SUPER_DISTRIBUTOR";

  const [form, setForm] = useState({
    phone: initial?.phone ?? "",
    email: initial?.email ?? "",
    name: initial?.name ?? "",
    role: initialRole,
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
    setTimeout(() => onCreated(data), 1500);
  }

  return (
    <div className="rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white p-6 shadow-soft">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-display text-lg font-bold text-ink-900">{title}</h3>
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
            {submitLabel}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
