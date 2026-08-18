import * as React from "react";
import { cn } from "@/lib/utils";

export type PillTone =
  | "success"
  | "warning"
  | "danger"
  | "brand"
  | "violet"
  | "neutral";

const toneClass: Record<PillTone, string> = {
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200/70",
  warning: "bg-amber-50 text-amber-700 ring-amber-200/70",
  danger: "bg-rose-50 text-rose-700 ring-rose-200/70",
  brand: "bg-brand-50 text-brand-700 ring-brand-200/70",
  violet: "bg-violet-50 text-violet-700 ring-violet-200/70",
  neutral: "bg-ink-50 text-ink-600 ring-ink-200/70",
};

const dotClass: Record<PillTone, string> = {
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
  brand: "bg-brand-500",
  violet: "bg-violet-500",
  neutral: "bg-ink-400",
};

const SUCCESS_RE =
  /^(success|succeeded|approved|active|completed|complete|verified|paid|settled|credit|credited|enabled|resolved|online|done|live|accepted|granted|ok)$/i;
const WARNING_RE =
  /^(pending|processing|awaiting.*|in.?progress|review|under.?review|hold|on.?hold|initiated|partial|queued|submitted|requested|open)$/i;
const DANGER_RE =
  /^(failed|failure|rejected|blocked|suspended|disabled|expired|overdue|chargeback|cancelled|canceled|declined|debit|debited|inactive|error|reversed)$/i;

/** Infer a tone from a raw status string. */
export function statusTone(status: string): PillTone {
  const s = status.replace(/[_-]+/g, " ").trim();
  if (SUCCESS_RE.test(s)) return "success";
  if (WARNING_RE.test(s)) return "warning";
  if (DANGER_RE.test(s)) return "danger";
  return "neutral";
}

/**
 * StatusPill — status chip with dot; auto-colors from the status text
 * (success/pending/failed conventions) unless `tone` is given.
 */
export function StatusPill({
  status,
  tone,
  className,
  children,
}: {
  status: string;
  tone?: PillTone;
  className?: string;
  /** Custom label; defaults to `status`. */
  children?: React.ReactNode;
}) {
  const t = tone ?? statusTone(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1",
        toneClass[t],
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass[t])} aria-hidden />
      {children ?? status}
    </span>
  );
}
