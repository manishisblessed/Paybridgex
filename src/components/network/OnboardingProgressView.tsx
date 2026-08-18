import {
  CheckCircle2,
  XCircle,
  Clock,
  Circle,
  Info,
  Loader2,
} from "lucide-react";

// Shared, status-only onboarding/KYC progress view. Rendered both on the
// network member detail page (registered downline) and inside the "Pending
// invitations" progress modal (invitees still completing the wizard). It never
// shows document images or raw KYC PII — only step state and reasons.

export type OnboardStepStatus = "done" | "pending" | "rejected";

export type OnboardStep = {
  key: string;
  label: string;
  status: OnboardStepStatus;
  reason?: string | null;
  group: "identity" | "documents" | "declaration" | "review";
};

export type OnboardingProgress = {
  user?: {
    id: string;
    name: string | null;
    userCode: string | null;
    phone: string | null;
    role: string;
    createdAt: string | null;
  };
  hasInvite: boolean;
  inviteStatus: string | null;
  kycStatus: string | null;
  accountStatus: string;
  registeredAt: string | null;
  approvedAt: string | null;
  rejectedReason: string | null;
  steps: OnboardStep[];
  totalSteps: number;
  doneSteps: number;
  pendingSteps: number;
  rejected: { key: string; label: string; reason: string | null }[];
  waitingOn: "retailer" | "admin" | "upline" | "none";
  summary: string;
  updatedAt: string | null;
};

const STEP_GROUPS: { key: OnboardStep["group"]; label: string }[] = [
  { key: "identity", label: "Identity & bank" },
  { key: "documents", label: "Documents" },
  { key: "declaration", label: "Declarations" },
  { key: "review", label: "Review & activation" },
];

const WAITING_META: Record<
  OnboardingProgress["waitingOn"],
  { label: string; cls: string }
> = {
  none: { label: "Complete", cls: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  retailer: { label: "Action needed by the applicant", cls: "border-amber-200 bg-amber-50 text-amber-800" },
  admin: { label: "Waiting on admin approval", cls: "border-blue-200 bg-blue-50 text-blue-800" },
  upline: { label: "Waiting on upline approval", cls: "border-violet-200 bg-violet-50 text-violet-800" },
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-sm font-medium text-ink-900" title={value}>
        {value}
      </dd>
    </div>
  );
}

function StepIcon({ status }: { status: OnboardStepStatus }) {
  if (status === "done") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (status === "rejected") return <XCircle className="h-4 w-4 text-rose-600" />;
  return <Clock className="h-4 w-4 text-amber-500" />;
}

export function OnboardingProgressView({
  loading,
  error,
  data,
  memberName,
  memberStatus,
}: {
  loading: boolean;
  error: string | null;
  data: OnboardingProgress | null;
  memberName: string;
  memberStatus: string;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-ink-100 bg-white py-14 text-ink-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading onboarding status…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
        <Info className="mt-0.5 h-5 w-5 shrink-0" />
        <div>{error}</div>
      </div>
    );
  }

  if (!data || !data.hasInvite) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-ink-100 bg-white p-5 text-sm text-ink-600">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-ink-400" />
        <div>
          <p className="font-semibold text-ink-800">No onboarding record found</p>
          <p className="mt-1">
            {memberStatus === "Active"
              ? "This account is active. There is no pending onboarding to track."
              : "We couldn't find an onboarding trail for this member yet."}
          </p>
        </div>
      </div>
    );
  }

  const pct = data.totalSteps ? Math.round((data.doneSteps / data.totalSteps) * 100) : 0;
  const waiting = WAITING_META[data.waitingOn];
  const roleLabel = (data.user?.role ?? "").replace(/_/g, " ").toLowerCase() || "member";
  const capRole = roleLabel.charAt(0).toUpperCase() + roleLabel.slice(1);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-ink-100 bg-white p-5">
        <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
          {capRole} details
        </h4>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <DetailRow label={`${capRole} name`} value={data.user?.name || memberName || "—"} />
          <DetailRow label={`${capRole} ID`} value={data.user?.userCode || "—"} />
          <DetailRow label="Mobile number" value={data.user?.phone || "—"} />
          <DetailRow label="Registration date" value={fmtDate(data.registeredAt)} />
          <DetailRow
            label="Approval date"
            value={data.approvedAt ? fmtDate(data.approvedAt) : "Not yet approved"}
          />
          <DetailRow
            label="Current status"
            value={
              data.accountStatus === "ACTIVE"
                ? "Active"
                : data.kycStatus
                ? data.kycStatus.replace(/_/g, " ").toLowerCase()
                : data.registeredAt
                ? (data.inviteStatus ?? "In progress")
                : "Awaiting registration"
            }
          />
        </dl>
        {data.waitingOn !== "none" && data.rejectedReason && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
              Pending / reject reason
            </dt>
            <dd className="mt-0.5 text-sm text-amber-900">{data.rejectedReason}</dd>
          </div>
        )}
      </div>

      <div className={`rounded-2xl border p-4 ${waiting.cls}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-wide">{waiting.label}</p>
          <span className="text-xs font-semibold">
            {data.doneSteps}/{data.totalSteps} steps · {pct}%
          </span>
        </div>
        <p className="mt-1 text-sm">{data.summary}</p>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/60">
          <div
            className={`h-full rounded-full ${
              data.waitingOn === "none" ? "bg-emerald-500" : "bg-brand-500"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {data.rejected.length > 0 && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-rose-800">
            <XCircle className="h-4 w-4" /> Needs re-upload by {memberName}
          </p>
          <ul className="space-y-1.5">
            {data.rejected.map((r) => (
              <li key={r.key} className="text-sm text-rose-700">
                <span className="font-medium">{r.label}</span>
                {r.reason ? <span className="text-rose-600"> — {r.reason}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-2xl border border-ink-100 bg-white p-5">
        <div className="space-y-5">
          {STEP_GROUPS.map((g) => {
            const list = data.steps.filter((s) => s.group === g.key);
            if (list.length === 0) return null;
            return (
              <div key={g.key}>
                <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                  {g.label}
                </h4>
                <ul className="divide-y divide-ink-50">
                  {list.map((s) => (
                    <li key={s.key} className="flex items-start gap-3 py-2.5">
                      <span className="mt-0.5 shrink-0">
                        <StepIcon status={s.status} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-ink-900">{s.label}</span>
                          <span
                            className={`text-[11px] font-semibold ${
                              s.status === "done"
                                ? "text-emerald-600"
                                : s.status === "rejected"
                                ? "text-rose-600"
                                : "text-amber-600"
                            }`}
                          >
                            {s.status === "done"
                              ? "Done"
                              : s.status === "rejected"
                              ? "Rejected"
                              : "Pending"}
                          </span>
                        </div>
                        {s.status === "rejected" && s.reason && (
                          <p className="mt-0.5 text-xs text-rose-600">{s.reason}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
        <p className="mt-4 flex items-center gap-1.5 border-t border-ink-50 pt-3 text-[11px] text-ink-400">
          <Circle className="h-3 w-3" /> Document images &amp; KYC details are visible to admins and the direct parent.
        </p>
      </div>
    </div>
  );
}
