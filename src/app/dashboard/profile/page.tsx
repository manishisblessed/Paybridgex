"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  User,
  Save,
  BadgeCheck,
  ShieldCheck,
  Upload,
  FileCheck,
  Clock,
  XCircle,
  AlertTriangle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { ServicePageHeader } from "@/components/dashboard/ServicePage";
import { Input, Label } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Panel, DarkPanel, StatusPill, SectionTitle } from "@/components/dashboard/ui";
import { Reveal } from "@/components/motion";
import { type Session } from "@/lib/auth";
import { useAuth } from "@/lib/useAuth";

type KycData = {
  id: string;
  status: "NOT_STARTED" | "PENDING_REVIEW" | "APPROVED" | "REJECTED";
  panNumber: string | null;
  aadhaarLast4: string | null;
  gstin: string | null;
  dob: string | null;
  rejectedReason: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
} | null;

type DocRecord = {
  id: string;
  type: string;
  publicId: string;
  url: string;
  format: string | null;
  uploadedAt: string;
};

const DOC_TYPES = [
  { key: "PAN", label: "PAN Card" },
  { key: "AADHAAR_FRONT", label: "Aadhaar (Front)" },
  { key: "AADHAAR_BACK", label: "Aadhaar (Back)" },
  { key: "SHOP_PHOTO", label: "Shop Photo" },
  { key: "BANK_PROOF", label: "Bank Proof" },
] as const;

export default function ProfilePage() {
  const { session: authSession } = useAuth();
  const [session, setSession] = useState<Session | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // KYC state
  const [kyc, setKyc] = useState<KycData>(null);
  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [kycLoading, setKycLoading] = useState(true);
  const [pan, setPan] = useState("");
  const [aadhaar4, setAadhaar4] = useState("");
  const [gstin, setGstin] = useState("");
  const [dob, setDob] = useState("");
  const [kycSubmitting, setKycSubmitting] = useState(false);
  const [kycError, setKycError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  useEffect(() => {
    if (authSession && !session) {
      setSession({ ...authSession });
    }
  }, [authSession, session]);

  const fetchKyc = useCallback(async () => {
    try {
      setKycLoading(true);
      const res = await fetch("/api/kyc");
      if (res.ok) {
        const json = await res.json();
        setKyc(json.kyc);
        setDocs(json.documents);
        if (json.kyc) {
          setPan(json.kyc.panNumber ?? "");
          setAadhaar4(json.kyc.aadhaarLast4 ?? "");
          setGstin(json.kyc.gstin ?? "");
          setDob(json.kyc.dob ? json.kyc.dob.slice(0, 10) : "");
        }
      }
    } finally {
      setKycLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKyc();
  }, [fetchKyc]);

  if (!session) return null;

  function update<K extends keyof Session>(k: K, v: Session[K]) {
    if (!session) return;
    setSession({ ...session, [k]: v });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    setSaving(true);
    await new Promise((r) => setTimeout(r, 600));
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function uploadDoc(type: string, file: File) {
    setUploading(type);
    try {
      // 1. Get signed params
      const signRes = await fetch("/api/uploads/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, isSensitive: true }),
      });
      if (!signRes.ok) throw new Error("Failed to get upload signature");
      const params = await signRes.json();

      // 2. Upload to Cloudinary
      const formData = new FormData();
      formData.append("file", file);
      formData.append("api_key", params.apiKey);
      formData.append("timestamp", String(params.timestamp));
      formData.append("signature", params.signature);
      formData.append("folder", params.folder);
      formData.append("type", params.type);

      const uploadRes = await fetch(
        `https://api.cloudinary.com/v1_1/${params.cloudName}/auto/upload`,
        { method: "POST", body: formData }
      );
      if (!uploadRes.ok) throw new Error("Cloudinary upload failed");
      const cloudResult = await uploadRes.json();

      // 3. Persist document record
      const docRes = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          publicId: cloudResult.public_id,
          url: cloudResult.secure_url,
          resourceType: cloudResult.resource_type,
          format: cloudResult.format,
          bytes: cloudResult.bytes,
          width: cloudResult.width,
          height: cloudResult.height,
        }),
      });
      if (!docRes.ok) throw new Error("Failed to save document");

      await fetchKyc();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(null);
    }
  }

  async function submitKyc(e: React.FormEvent) {
    e.preventDefault();
    setKycError(null);
    setKycSubmitting(true);
    try {
      const res = await fetch("/api/kyc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          panNumber: pan.toUpperCase(),
          aadhaarLast4: aadhaar4,
          gstin: gstin || undefined,
          dob: dob || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          typeof json.error === "string"
            ? json.error
            : JSON.stringify(json.error)
        );
      }
      await fetchKyc();
    } catch (err) {
      setKycError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setKycSubmitting(false);
    }
  }

  const kycStatus = kyc?.status ?? "NOT_STARTED";
  const canSubmitKyc =
    kycStatus === "NOT_STARTED" || kycStatus === "REJECTED";
  const uploadedTypes = new Set(docs.map((d) => d.type));

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <Reveal distance={14} duration={0.4}>
        <ServicePageHeader
          icon={User}
          title="Profile"
          description="Manage your personal details, KYC status and account preferences."
        />
      </Reveal>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Sidebar */}
        <aside className="space-y-4">
          <Reveal distance={16} duration={0.45}>
            <DarkPanel className="p-6 text-center">
              <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-accent-500 font-display text-xl font-bold text-white shadow-glow ring-2 ring-white/20">
                {session.name
                  .split(" ")
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join("")}
              </div>
              <h2 className="mt-4 font-display text-lg font-semibold text-white">
                {session.name}
              </h2>
              <p className="text-xs text-white/60">{session.email}</p>
              <span className="mt-3 inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold capitalize text-white ring-1 ring-white/15">
                {session.role}
              </span>
            </DarkPanel>
          </Reveal>

          {/* KYC Status Card */}
          <Panel>
            <p className="text-[10px] font-bold uppercase tracking-widest text-ink-500">
              KYC Status
            </p>
            {kycLoading ? (
              <p className="mt-2 text-sm text-ink-500">Loading…</p>
            ) : (
              <>
                <div className="mt-3">
                  {kycStatus === "APPROVED" && (
                    <StatusPill status="APPROVED" tone="success">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Verified
                    </StatusPill>
                  )}
                  {kycStatus === "PENDING_REVIEW" && (
                    <StatusPill status="PENDING_REVIEW" tone="warning">
                      <Clock className="h-3.5 w-3.5" />
                      Under review
                    </StatusPill>
                  )}
                  {kycStatus === "REJECTED" && (
                    <div className="space-y-2">
                      <StatusPill status="REJECTED" tone="danger">
                        <XCircle className="h-3.5 w-3.5" />
                        Rejected
                      </StatusPill>
                      {kyc?.rejectedReason && (
                        <p className="text-xs text-rose-600">
                          {kyc.rejectedReason}
                        </p>
                      )}
                    </div>
                  )}
                  {kycStatus === "NOT_STARTED" && (
                    <StatusPill status="NOT_STARTED" tone="neutral">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Not submitted
                    </StatusPill>
                  )}
                </div>

                {kycStatus === "APPROVED" && (
                  <div className="mt-4 space-y-2">
                    {kyc?.panNumber && (
                      <div className="flex items-center gap-2 text-xs text-emerald-800">
                        <BadgeCheck className="h-3.5 w-3.5" />
                        PAN: {kyc.panNumber}
                      </div>
                    )}
                    {kyc?.aadhaarLast4 && (
                      <div className="flex items-center gap-2 text-xs text-emerald-800">
                        <BadgeCheck className="h-3.5 w-3.5" />
                        Aadhaar: XXXX-XXXX-{kyc.aadhaarLast4}
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-xs text-emerald-800">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Account active
                    </div>
                  </div>
                )}
              </>
            )}
          </Panel>
        </aside>

        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Profile form */}
          <form
            onSubmit={save}
            className="grid gap-4 rounded-2xl border border-ink-100 bg-white p-6 shadow-sm sm:grid-cols-2"
          >
            <div className="sm:col-span-2">
              <Label htmlFor="name">Full name</Label>
              <Input
                id="name"
                value={session.name}
                onChange={(e) => update("name", e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={session.email}
                onChange={(e) => update("email", e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={session.phone}
                onChange={(e) => update("phone", e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" isLoading={saving} disabled={saving}>
                <Save className="h-4 w-4" />
                {saving ? "Saving…" : saved ? "Saved!" : "Save changes"}
              </Button>
            </div>
          </form>

          {/* KYC Section */}
          {canSubmitKyc && (
            <Panel className="p-6">
              <SectionTitle
                title="Complete your KYC"
                description="Upload required documents and fill in your details to activate your account."
                className="mb-0"
              />

              {kycStatus === "REJECTED" && kyc?.rejectedReason && (
                <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    <strong>Previous submission rejected:</strong>{" "}
                    {kyc.rejectedReason}. Please correct and re-submit.
                  </span>
                </div>
              )}

              {/* Document uploads */}
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {DOC_TYPES.map((dt) => {
                  const uploaded = uploadedTypes.has(dt.key);
                  const busy = uploading === dt.key;
                  return (
                    <div
                      key={dt.key}
                      className={`flex items-center justify-between rounded-xl border px-4 py-3 ${
                        uploaded
                          ? "border-emerald-200 bg-emerald-50"
                          : "border-ink-200 bg-ink-50/40"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {uploaded ? (
                          <FileCheck className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <Upload className="h-4 w-4 text-ink-400" />
                        )}
                        <span
                          className={`text-sm font-medium ${uploaded ? "text-emerald-800" : "text-ink-700"}`}
                        >
                          {dt.label}
                          {dt.key === "PAN" || dt.key === "AADHAAR_FRONT" ? (
                            <span className="text-rose-500"> *</span>
                          ) : null}
                        </span>
                      </div>
                      {uploaded ? (
                        <StatusPill status="Uploaded" tone="success" />
                      ) : (
                        <label className="cursor-pointer">
                          <input
                            type="file"
                            accept="image/*,.pdf"
                            className="hidden"
                            disabled={busy}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) uploadDoc(dt.key, f);
                            }}
                          />
                          <span className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:border-brand-300 hover:text-brand-700">
                            {busy ? (
                              <Loader2 className="inline h-3 w-3 animate-spin" />
                            ) : (
                              "Upload"
                            )}
                          </span>
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* KYC details form */}
              <form onSubmit={submitKyc} className="mt-5 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="pan">PAN Number *</Label>
                    <Input
                      id="pan"
                      required
                      maxLength={10}
                      className="uppercase"
                      placeholder="ABCDE1234F"
                      value={pan}
                      onChange={(e) => setPan(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="aadhaar4">Aadhaar last 4 digits *</Label>
                    <Input
                      id="aadhaar4"
                      required
                      maxLength={4}
                      inputMode="numeric"
                      placeholder="1234"
                      value={aadhaar4}
                      onChange={(e) =>
                        setAadhaar4(e.target.value.replace(/\D/g, ""))
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="gstin">GSTIN (optional)</Label>
                    <Input
                      id="gstin"
                      maxLength={15}
                      className="uppercase"
                      placeholder="22AAAAA0000A1Z5"
                      value={gstin}
                      onChange={(e) => setGstin(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="dob">Date of birth (optional)</Label>
                    <Input
                      id="dob"
                      type="date"
                      value={dob}
                      onChange={(e) => setDob(e.target.value)}
                    />
                  </div>
                </div>

                {kycError && (
                  <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{kycError}</span>
                  </div>
                )}

                <Button type="submit" isLoading={kycSubmitting} disabled={kycSubmitting}>
                  <ShieldCheck className="h-4 w-4" />
                  {kycSubmitting ? "Submitting…" : "Submit KYC for review"}
                </Button>
              </form>
            </Panel>
          )}

          {kycStatus === "PENDING_REVIEW" && (
            <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-6 text-center shadow-sm">
              <Clock className="mx-auto h-10 w-10 text-amber-500" />
              <h3 className="mt-3 font-display text-lg font-semibold text-ink-900">
                KYC under review
              </h3>
              <p className="mt-1 text-sm text-ink-600">
                Your documents have been submitted and are being reviewed. This
                usually takes 1–2 business days. You&apos;ll be notified once
                your account is activated.
              </p>
              {kyc?.submittedAt && (
                <p className="mt-3 text-xs text-ink-500">
                  Submitted on{" "}
                  {new Date(kyc.submittedAt).toLocaleDateString("en-IN", {
                    dateStyle: "long",
                  })}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
