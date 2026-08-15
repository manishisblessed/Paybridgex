"use client";

import { cn } from "@/lib/utils";
import { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";

export type Column<T> = {
  key: keyof T | string;
  header: string;
  align?: "left" | "right" | "center";
  className?: string;
  render?: (row: T) => ReactNode;
};

export function DataTable<T>({
  title,
  description,
  columns,
  data,
  action,
  empty = "No records to show.",
  loading = false,
  loadingRows = 5,
}: {
  title?: string;
  description?: string;
  columns: Column<T>[];
  data: T[];
  action?: ReactNode;
  empty?: string;
  loading?: boolean;
  loadingRows?: number;
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-sm">
      {(title || action) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
          <div className="min-w-0">
            {title && (
              <h3 className="flex items-center gap-2 font-display text-base font-semibold text-ink-900">
                <span className="inline-block h-4 w-1 rounded-full bg-gradient-to-b from-brand-500 to-accent-500" aria-hidden />
                {title}
              </h3>
            )}
            {description && (
              <p className="mt-0.5 truncate text-xs text-ink-500">{description}</p>
            )}
          </div>
          {action && <div className="flex items-center gap-2">{action}</div>}
        </div>
      )}
      <div className="w-full overflow-x-auto">
        <table className="w-full min-w-max text-sm">
          <thead className="sticky top-0 z-[1] bg-ink-50/80 text-left text-[11px] uppercase tracking-wider text-ink-500 backdrop-blur">
            <tr>
              {columns.map((c) => (
                <th
                  key={String(c.key)}
                  className={cn(
                    "whitespace-nowrap px-5 py-3 font-semibold",
                    c.align === "right" && "text-right",
                    c.align === "center" && "text-center"
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100/80 text-ink-800">
            {loading ? (
              Array.from({ length: loadingRows }).map((_, r) => (
                <tr key={`sk-${r}`}>
                  {columns.map((c, i) => (
                    <td key={String(c.key)} className="px-5 py-3">
                      <Skeleton
                        className={cn(
                          "h-3.5",
                          i === 0 ? "w-28" : i === columns.length - 1 ? "w-16 ml-auto" : "w-24"
                        )}
                      />
                    </td>
                  ))}
                </tr>
              ))
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-5 py-12">
                  <div className="flex flex-col items-center gap-3 text-center">
                    <span className="grid h-12 w-12 place-items-center rounded-2xl border border-dashed border-ink-200 bg-ink-50/60 text-ink-300">
                      <Inbox className="h-5 w-5" />
                    </span>
                    <p className="max-w-xs text-sm text-ink-500">{empty}</p>
                  </div>
                </td>
              </tr>
            ) : (
              data.map((row, i) => (
                <tr
                  key={(row as { id?: string | number }).id ?? i}
                  className="transition-colors duration-150 hover:bg-brand-50/40"
                >
                  {columns.map((c) => (
                    <td
                      key={String(c.key)}
                      className={cn(
                        "whitespace-nowrap px-5 py-3",
                        c.align === "right" && "text-right",
                        c.align === "center" && "text-center",
                        c.className
                      )}
                    >
                      {c.render
                        ? c.render(row)
                        : ((row as Record<string, unknown>)[
                            String(c.key)
                          ] as ReactNode)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
