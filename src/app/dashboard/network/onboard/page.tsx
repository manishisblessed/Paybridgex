"use client";

import { useState } from "react";
import { Send, CheckCircle2, Link2, Copy } from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Panel } from "@/components/dashboard/ui";
import { Reveal } from "@/components/motion";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { type Role } from "@/lib/auth";
import { useAuth } from "@/lib/useAuth";

export default function OnboardInvitePage() {
  const { session } = useAuth();
  const role: Role = session?.role ?? "retailer";
  const [done, setDone] = useState(false);
  const [onboardingLink, setOnboardingLink] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
  });

  const childLabel =
    role === "super-distributor" ? "Master Distributor" :
    role === "master-distributor" ? "Distributor" :
    "Retailer";

  function updateForm(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/admin/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name || undefined,
          email: form.email,
          phone: form.phone.replace(/\s/g, ""),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to send invite");
        return;
      }

      setOnboardingLink(data.invite.onboardingLink);
      setDone(true);
    } catch {
      setError("Network error — please try again");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyLink() {
    await navigator.clipboard.writeText(onboardingLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (done) {
    return (
      <Reveal distance={14} duration={0.4}>
      <div className="mx-auto max-w-xl rounded-3xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-10 text-center shadow-soft">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-500 text-white shadow-glow">
          <CheckCircle2 className="h-8 w-8" />
        </div>
        <h2 className="mt-5 font-display text-2xl font-bold text-ink-900">
          Invite Sent!
        </h2>
        <p className="mt-2 text-sm text-ink-600">
          An onboarding link has been sent to <strong>{form.email}</strong> and <strong>{form.phone}</strong>.
          They&apos;ll receive an email and SMS with the registration link.
        </p>

        <div className="mt-5 rounded-xl border border-ink-200 bg-white p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-500">
            Onboarding Link
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-700">
              {onboardingLink}
            </code>
            <button
              onClick={copyLink}
              className="rounded-lg border border-ink-200 p-2 text-ink-600 hover:bg-ink-50"
              title="Copy link"
            >
              {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-2 text-xs text-ink-500">
            You can also share this link manually before it expires.
          </p>
        </div>

        <div className="mt-6">
          <Button onClick={() => { setDone(false); setForm({ name: "", phone: "", email: "" }); }}>
            <Send className="h-4 w-4" /> Send Another Invite
          </Button>
        </div>
      </div>
      </Reveal>
    );
  }

  return (
    <div className="space-y-6">
      <Reveal distance={14} duration={0.4}>
        <PageHeader
          eyebrow="Invite"
          title={`Invite a ${childLabel}`}
          description={`Send an onboarding link via email and SMS. The ${childLabel.toLowerCase()} will complete their own registration and KYC.`}
        />
      </Reveal>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <Reveal distance={16} duration={0.45}>
      <Panel flush className="mx-auto max-w-lg p-6 shadow-soft">
      <form onSubmit={handleSubmit}>
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-brand-100 bg-brand-50/70 px-4 py-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-soft">
            <Link2 className="h-4 w-4" />
          </span>
          <p className="text-sm text-brand-900">
            An onboarding link will be sent to the invitee. They&apos;ll register themselves — you won&apos;t need to enter their personal details.
          </p>
        </div>

        <div className="grid gap-5">
          <div>
            <Label>Name (optional)</Label>
            <Input
              value={form.name}
              onChange={(e) => updateForm("name", e.target.value)}
              placeholder="Full name of the invitee"
            />
          </div>
          <div>
            <Label>Mobile Number *</Label>
            <Input
              required
              value={form.phone}
              onChange={(e) => updateForm("phone", e.target.value)}
              placeholder="+91 98765 43210"
            />
          </div>
          <div>
            <Label>Email *</Label>
            <Input
              required
              type="email"
              value={form.email}
              onChange={(e) => updateForm("email", e.target.value)}
              placeholder="user@example.com"
            />
          </div>

          <div className="rounded-xl border border-ink-100 bg-ink-50/50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">Inviting as</p>
            <p className="mt-1 font-semibold text-ink-900">{childLabel}</p>
            <p className="text-xs text-ink-500">This person will be mapped under your network.</p>
          </div>
        </div>

        <div className="mt-6">
          <Button type="submit" isLoading={submitting} className="w-full">
            <Send className="h-4 w-4" />
            Send Onboarding Invite
          </Button>
        </div>
      </form>
      </Panel>
      </Reveal>
    </div>
  );
}
