import * as React from "react";
import { Inbox } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * EmptyState — branded placeholder with icon, message and optional CTA.
 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  message,
  cta,
  className,
  compact = false,
}: {
  icon?: LucideIcon;
  title?: React.ReactNode;
  message?: React.ReactNode;
  cta?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-ink-200 bg-ink-50/50 text-center",
        compact ? "px-4 py-8" : "px-6 py-12",
        className
      )}
    >
      <span className="grid h-12 w-12 place-items-center rounded-2xl border border-dashed border-ink-200 bg-white text-ink-300">
        <Icon className="h-5 w-5" />
      </span>
      {title && (
        <p className="font-display text-sm font-semibold text-ink-900">{title}</p>
      )}
      {message && <p className="max-w-sm text-sm text-ink-500">{message}</p>}
      {cta && <div className="mt-1">{cta}</div>}
    </div>
  );
}
