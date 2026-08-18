import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * SectionTitle — gradient tick + display heading for a page section,
 * with optional description and trailing action.
 */
export function SectionTitle({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-4 flex flex-wrap items-end justify-between gap-3",
        className
      )}
    >
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-ink-900">
          <span
            className="inline-block h-4 w-1 rounded-full bg-gradient-to-b from-brand-500 to-accent-500"
            aria-hidden
          />
          {title}
        </h2>
        {description && (
          <p className="mt-0.5 text-sm text-ink-500">{description}</p>
        )}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}
