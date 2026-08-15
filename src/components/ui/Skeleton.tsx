import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-xl bg-ink-100/80",
        className
      )}
      aria-hidden
    />
  );
}

export function StatSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-ink-100 bg-white p-4 shadow-sm",
        className
      )}
    >
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-3 h-7 w-28" />
      <Skeleton className="mt-2 h-3 w-16" />
    </div>
  );
}

export function TableSkeleton({
  rows = 5,
  cols = 4,
  className,
}: {
  rows?: number;
  cols?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-sm",
        className
      )}
    >
      <div className="border-b border-ink-100 px-5 py-4">
        <Skeleton className="h-4 w-36" />
      </div>
      <div className="divide-y divide-ink-100">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 px-5 py-3.5">
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton
                key={c}
                className={cn(
                  "h-3.5 flex-1",
                  c === 0 && "max-w-[8rem]",
                  c === cols - 1 && "max-w-[5rem]"
                )}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function DashboardShellSkeleton() {
  return (
    <div className="flex min-h-screen bg-gradient-to-br from-ink-50/70 via-white to-brand-50/30">
      <aside className="hidden w-72 shrink-0 bg-[#0b1030] p-4 lg:block">
        <div className="mb-8 h-8 w-36 animate-pulse rounded-xl bg-white/10" />
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-10 w-full animate-pulse rounded-xl bg-white/[0.06]" />
          ))}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-16 items-center justify-between border-b border-ink-100 bg-white/80 px-4 md:px-8">
          <Skeleton className="h-9 w-48 rounded-full" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-24 rounded-full" />
            <Skeleton className="h-9 w-9 rounded-full" />
            <Skeleton className="h-9 w-36 rounded-full" />
          </div>
        </div>
        <main className="flex-1 px-4 py-6 md:px-8 md:py-10">
          <div className="mx-auto w-full max-w-[1400px] space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <StatSkeleton key={i} />
              ))}
            </div>
            <TableSkeleton rows={6} cols={5} />
          </div>
        </main>
      </div>
    </div>
  );
}
