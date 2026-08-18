import * as React from "react";
import { SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * FilterBar — one styled row that hosts date-range pickers, selects,
 * search inputs and action buttons. Children keep their own handlers.
 */
export function FilterBar({
  children,
  className,
  label,
  hideIcon = false,
}: {
  children: React.ReactNode;
  className?: string;
  /** Optional leading label, e.g. "Filters". */
  label?: string;
  hideIcon?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-2xl border border-ink-100 bg-white/80 p-3 shadow-sm backdrop-blur",
        className
      )}
    >
      {!hideIcon && (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink-50 text-ink-400">
          <SlidersHorizontal className="h-4 w-4" />
        </span>
      )}
      {label && (
        <span className="text-xs font-bold uppercase tracking-widest text-ink-500">
          {label}
        </span>
      )}
      {children}
    </div>
  );
}

/** Small labelled wrapper for a single filter control. */
export function FilterField({
  label,
  children,
  className,
}: {
  label?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      {label && (
        <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-ink-400">
          {label}
        </p>
      )}
      {children}
    </div>
  );
}
