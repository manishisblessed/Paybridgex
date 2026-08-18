import * as React from "react";
import { Inbox } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";

/**
 * TablePro — presentational shell for raw `<table>` markup.
 *
 * Wrap an existing table and the shell auto-styles thead/th/td/tr via
 * descendant selectors: rounded container, sticky muted header, zebra hover,
 * consistent paddings. Keep alignment utilities (text-right etc.) on cells;
 * strip old padding/border classes.
 *
 * ```tsx
 * <TablePro title="Settlements" action={<Button …/>}>
 *   <table>…</table>
 * </TablePro>
 * ```
 */
export function TablePro({
  title,
  description,
  action,
  footer,
  children,
  className,
  bodyClassName,
  dense = false,
  /** Constrain height so the sticky header engages, e.g. "max-h-[32rem]". */
  maxHeight,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  dense?: boolean;
  maxHeight?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-sm",
        className
      )}
    >
      {(title || action) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
          <div className="min-w-0">
            {title && (
              <h3 className="flex items-center gap-2 font-display text-base font-semibold text-ink-900">
                <span
                  className="inline-block h-4 w-1 rounded-full bg-gradient-to-b from-brand-500 to-accent-500"
                  aria-hidden
                />
                {title}
              </h3>
            )}
            {description && (
              <p className="mt-0.5 text-xs text-ink-500">{description}</p>
            )}
          </div>
          {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
        </div>
      )}
      <div
        className={cn(
          "w-full overflow-x-auto",
          maxHeight && cn("overflow-y-auto", maxHeight),
          // table
          "[&_table]:w-full [&_table]:min-w-max [&_table]:text-sm",
          // header
          "[&_thead]:sticky [&_thead]:top-0 [&_thead]:z-[1] [&_thead]:bg-ink-50/80 [&_thead]:text-left [&_thead]:backdrop-blur",
          "[&_thead_th]:whitespace-nowrap [&_thead_th]:font-semibold [&_thead_th]:uppercase [&_thead_th]:tracking-wider [&_thead_th]:text-[11px] [&_thead_th]:text-ink-500",
          dense
            ? "[&_thead_th]:px-4 [&_thead_th]:py-2.5"
            : "[&_thead_th]:px-5 [&_thead_th]:py-3",
          // body
          "[&_tbody]:text-ink-800",
          "[&_tbody_tr]:border-t [&_tbody_tr]:border-ink-100/80 [&_tbody_tr]:transition-colors [&_tbody_tr]:duration-150",
          "[&_tbody_tr:hover]:bg-brand-50/40",
          dense
            ? "[&_tbody_td]:px-4 [&_tbody_td]:py-2.5"
            : "[&_tbody_td]:px-5 [&_tbody_td]:py-3",
          "[&_tbody_td]:whitespace-nowrap [&_tbody_td]:align-middle",
          bodyClassName
        )}
      >
        {children}
      </div>
      {footer && (
        <div className="border-t border-ink-100 bg-ink-50/40 px-5 py-3">
          {footer}
        </div>
      )}
    </div>
  );
}

/** Full-width empty-state row for a tbody. */
export function TableEmptyRow({
  colSpan,
  icon: Icon = Inbox,
  message = "No records to show.",
  cta,
}: {
  colSpan: number;
  icon?: LucideIcon;
  message?: React.ReactNode;
  cta?: React.ReactNode;
}) {
  return (
    <tr className="hover:!bg-transparent">
      <td colSpan={colSpan} className="!px-5 !py-12">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl border border-dashed border-ink-200 bg-ink-50/60 text-ink-300">
            <Icon className="h-5 w-5" />
          </span>
          <p className="max-w-xs whitespace-normal text-sm text-ink-500">
            {message}
          </p>
          {cta}
        </div>
      </td>
    </tr>
  );
}

/** Skeleton loading rows for a tbody. */
export function TableSkeletonRows({
  rows = 5,
  cols,
}: {
  rows?: number;
  cols: number;
}) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={`sk-${r}`} className="hover:!bg-transparent">
          {Array.from({ length: cols }).map((__, c) => (
            <td key={c}>
              <Skeleton
                className={cn(
                  "h-3.5",
                  c === 0 ? "w-28" : c === cols - 1 ? "ml-auto w-16" : "w-24"
                )}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
