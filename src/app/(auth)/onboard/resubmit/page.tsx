"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  ShieldCheck,
  Upload,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { GpsPhotoCapture } from "@/components/kyc/GpsPhotoCapture";
import { SelfieCapture } from "@/components/kyc/SelfieCapture";
import { LivenessVideoCapture } from "@/components/kyc/LivenessVideoCapture";
import { InAppBrowserWarning } from "@/components/kyc/InAppBrowserWarning";

type ResubmitDoc = { type: string; label: string; reason: string | null; done?: boolean };

type InviteData = {
  id: string;
  name: string | null;
  role: string;
  status: string;
  email: string;
  phone: string;
  expiresAt: string;
};

const GPS_TYPES = new Set([
  "GPS_PHOTO_OUTSIDE",
  "GPS_PHOTO_INSIDE",
  "GPS_SELFIE_DISTRIBUTOR",
]);

const IMAGE_ONLY = new Set([
  "SIGNATURE",
  "GPS_PHOTO_OUTSIDE",
  "GPS_PHOTO_INSIDE",
  "GPS_SELFIE_DISTRIBUTOR",
  "SELFIE",
]);

function acceptFor(type: string): string {
  return IMAGE_ONLY.has(type) ? "image/*" : "image/*,.pdf";
}

export default function ResubmitPage() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-screen place-items-center bg-ink-50">
          <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
        </div>
      }
    >
      <ResubmitInner />
    </Suspense>
  );
}

function ResubmitInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<InviteData | null>(null);
  const [docs, setDocs] = useState<ResubmitDoc[]>([]);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const load = useCallback(async () => {
    if (!token) {
      setError("Invalid link. No token found.");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/onboard/${token}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "This link is not valid.");
        setLoading(false);
        return;
      }
      if (data.invite?.status !== "RESUBMIT") {
        setError(
          "This link is not open for document re-upload. It may have already been submitted."
        );
        setLoading(false);
        return;
      }
      const resubmitDocs: ResubmitDoc[] = data.resubmit?.documents ?? [];
      setInvite(data.invite);
      setDocs(resubmitDocs);
      // Hydrate completion state so a mid-session reload keeps re-uploaded
      // documents marked as done.
      const initialDone: Record<string, boolean> = {};
      for (const d of resubmitDocs) if (d.done) initialDone[d.type] = true;
      setDone(initialDone);
    } catch {
      setError("Could not load your re-upload request. Please try again.");
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const markDone = useCallback((type: string) => {
    setDone((prev) => ({ ...prev, [type]: true }));
  }, []);

  // ── Cloudinary document upload (file docs + GPS photos) ──
  const uploadDocument = useCallback(
    async (
      type: string,
      file: File,
      opts?: { gps?: { latitude: number; longitude: number; accuracy?: number; capturedAt?: string; source?: string } }
    ) => {
      setUploading(type);
      setUploadError(null);
      try {
        const signRes = await fetch(`/api/onboard/${token}/documents/sign`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type }),
        });
        if (!signRes.ok) throw new Error("Failed to get upload signature");
        const params = await signRes.json();

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
        if (!uploadRes.ok) throw new Error("Upload failed");
        const cloudResult = await uploadRes.json();

        const docRes = await fetch(`/api/onboard/${token}/documents`, {
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
            gpsLatitude: opts?.gps?.latitude,
            gpsLongitude: opts?.gps?.longitude,
            gpsAccuracy: opts?.gps?.accuracy,
            gpsCapturedAt: opts?.gps?.capturedAt,
            gpsSource: opts?.gps?.source,
          }),
        });
        if (!docRes.ok) {
          const j = await docRes.json().catch(() => ({}));
          throw new Error(j.error ?? "Failed to save document");
        }
        markDone(type);
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "Upload failed");
      }
      setUploading(null);
    },
    [token, markDone]
  );

  // ── Selfie upload (private S3, with Cloudinary fallback) ──
  const uploadSelfie = useCallback(
    async (file: File) => {
      setUploading("SELFIE");
      setUploadError(null);
      try {
        const contentType = file.type || "image/jpeg";
        const presignRes = await fetch(`/api/onboard/${token}/selfie/presign`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentType }),
        });
        if (!presignRes.ok) {
          await uploadDocument("SELFIE", file);
          return;
        }
        const presign = await presignRes.json();

        const putRes = await fetch(presign.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": contentType },
          body: file,
        });
        if (!putRes.ok) throw new Error("Upload to storage failed");

        const completeRes = await fetch(`/api/onboard/${token}/selfie/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: presign.key,
            uploadToken: presign.uploadToken,
            contentType,
          }),
        });
        if (!completeRes.ok) throw new Error("Failed to confirm selfie upload");
        markDone("SELFIE");
      } catch {
        await uploadDocument("SELFIE", file);
      }
      setUploading(null);
    },
    [token, uploadDocument, markDone]
  );

  const allDone = docs.length > 0 && docs.every((d) => done[d.type]);

  async function submit() {
    setSubmitting(true);
    setUploadError(null);
    try {
      const res = await fetch(`/api/onboard/${token}/resubmit`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setUploadError(
          data.error ??
            "Could not submit. Please make sure every requested document is re-uploaded."
        );
        setSubmitting(false);
        return;
      }
      setSubmitted(true);
    } catch {
      setUploadError("Network error. Please try again.");
    }
    setSubmitting(false);
  }

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-ink-50">
        <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="grid min-h-screen place-items-center bg-ink-50 px-4">
        <div className="max-w-md rounded-2xl border border-ink-100 bg-white p-8 text-center shadow-soft">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-rose-50">
            <XCircle className="h-6 w-6 text-rose-500" />
          </div>
          <h1 className="font-display text-lg font-bold text-ink-900">Link unavailable</h1>
          <p className="mt-2 text-sm text-ink-500">{error}</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="grid min-h-screen place-items-center bg-ink-50 px-4">
        <div className="max-w-md rounded-2xl border border-ink-100 bg-white p-8 text-center shadow-soft">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-emerald-50">
            <CheckCircle2 className="h-6 w-6 text-emerald-500" />
          </div>
          <h1 className="font-display text-lg font-bold text-ink-900">All done!</h1>
          <p className="mt-2 text-sm text-ink-500">
            Your documents have been re-submitted and your application is back under review.
            We&apos;ll notify you by email once it&apos;s approved.
          </p>
        </div>
      </div>
    );
  }

  const firstName = invite?.name?.split(" ")[0] ?? "there";

  return (
    <div className="min-h-screen bg-ink-50 px-4 py-8">
      <div className="mx-auto max-w-2xl">
        <InAppBrowserWarning />

        {/* Header */}
        <div className="mb-6 rounded-2xl border border-ink-100 bg-gradient-to-br from-brand-50/70 to-white p-6 shadow-soft">
          <div className="flex items-center gap-2 text-brand-700">
            <ShieldCheck className="h-5 w-5" />
            <span className="text-[11px] font-bold uppercase tracking-[0.2em]">
              Document re-upload
            </span>
          </div>
          <h1 className="mt-2 font-display text-2xl font-bold text-ink-900">
            Hi {firstName}, a quick re-upload is needed
          </h1>
          <p className="mt-2 text-sm text-ink-600">
            Our team reviewed your submission and a few documents need to be replaced.
            You don&apos;t need to redo anything else — just re-upload the {docs.length}{" "}
            document{docs.length === 1 ? "" : "s"} below and submit.
          </p>
        </div>

        {uploadError && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {uploadError}
          </div>
        )}

        {/* Document cards */}
        <div className="space-y-4">
          {docs.map((doc) => {
            const isDone = !!done[doc.type];
            return (
              <div
                key={doc.type}
                className={`rounded-2xl border p-5 shadow-soft transition ${
                  isDone ? "border-emerald-200 bg-emerald-50/50" : "border-ink-100 bg-white"
                }`}
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {isDone ? (
                        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                      ) : (
                        <FileText className="h-5 w-5 shrink-0 text-brand-500" />
                      )}
                      <p className="font-semibold text-ink-900">{doc.label}</p>
                    </div>
                    {doc.reason && (
                      <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        <span className="font-semibold">Reason for re-upload:</span> {doc.reason}
                      </div>
                    )}
                  </div>
                  {isDone && (
                    <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                      Re-uploaded
                    </span>
                  )}
                </div>

                <DocInput
                  doc={doc}
                  uploading={uploading === doc.type}
                  done={isDone}
                  onFile={(file) => uploadDocument(doc.type, file)}
                  onSelfie={(file) => uploadSelfie(file)}
                  onGps={(file, gps) => uploadDocument(doc.type, file, { gps })}
                  onVideoComplete={() => markDone(doc.type)}
                  token={token!}
                />
              </div>
            );
          })}
        </div>

        {/* Submit */}
        <div className="sticky bottom-4 mt-6">
          <div className="rounded-2xl border border-ink-100 bg-white/95 p-4 shadow-lg backdrop-blur">
            <div className="flex items-center justify-between gap-4">
              <p className="text-xs text-ink-500">
                {allDone
                  ? "All requested documents re-uploaded. You can submit now."
                  : `${docs.filter((d) => done[d.type]).length} of ${docs.length} re-uploaded`}
              </p>
              <Button onClick={submit} disabled={!allDone || submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Submitting…
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" /> Submit for review
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Per-document input switcher ────────────────────────────────────── */

function DocInput({
  doc,
  uploading,
  done,
  onFile,
  onSelfie,
  onGps,
  onVideoComplete,
  token,
}: {
  doc: ResubmitDoc;
  uploading: boolean;
  done: boolean;
  onFile: (file: File) => void;
  onSelfie: (file: File) => void;
  onGps: (file: File, gps: { latitude: number; longitude: number; accuracy?: number; capturedAt?: string; source?: string }) => void;
  onVideoComplete: () => void;
  token: string;
}) {
  if (GPS_TYPES.has(doc.type)) {
    return (
      <GpsPhotoCapture
        label={doc.label}
        required
        uploaded={done}
        uploading={uploading}
        facing={doc.type === "GPS_SELFIE_DISTRIBUTOR" ? "user" : "environment"}
        onCapture={(file, gps) => onGps(file, gps)}
      />
    );
  }

  if (doc.type === "SELFIE") {
    return (
      <SelfieCapture
        uploaded={done}
        uploading={uploading}
        onCapture={(file) => onSelfie(file)}
      />
    );
  }

  if (doc.type === "ONBOARD_VIDEO") {
    if (done) {
      return (
        <p className="text-sm font-medium text-emerald-700">
          Liveness video recorded successfully.
        </p>
      );
    }
    return (
      <LivenessVideoCapture onComplete={onVideoComplete} apiPrefix={`/api/onboard/${token}`} />
    );
  }

  return <FileUploader doc={doc} uploading={uploading} done={done} onFile={onFile} />;
}

/* ─── Plain file uploader ────────────────────────────────────────────── */

function FileUploader({
  doc,
  uploading,
  done,
  onFile,
}: {
  doc: ResubmitDoc;
  uploading: boolean;
  done: boolean;
  onFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={acceptFor(doc.type)}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className={`flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-3 text-sm font-semibold transition ${
          done
            ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            : "border-brand-200 bg-brand-50/50 text-brand-700 hover:bg-brand-50"
        } disabled:opacity-60`}
      >
        {uploading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Uploading…
          </>
        ) : done ? (
          <>
            <Upload className="h-4 w-4" /> Replace file
          </>
        ) : (
          <>
            <Upload className="h-4 w-4" /> Choose file to upload
          </>
        )}
      </button>
      <p className="mt-1.5 text-[11px] text-ink-400">
        {IMAGE_ONLY.has(doc.type) ? "Image files only" : "Image or PDF"}
      </p>
    </div>
  );
}
