"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { CountUp } from "@/components/motion";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";

export type StatTone =
  | "brand"
  | "emerald"
  | "violet"
  | "amber"
  | "rose"
  | "sky"
  | "ink"
  | "dark";

const chipTone: Record<StatTone, string> = {
  brand: "from-brand-500 to-brand-700",
  emerald: "from-emerald-500 to-emerald-700",
  violet: "from-violet-500 to-violet-700",
  amber: "from-amber-500 to-amber-600",
  rose: "from-rose-500 to-rose-700",
  sky: "from-sky-500 to-sky-700",
  ink: "from-ink-600 to-ink-800",
  dark: "from-brand-500 to-accent-500",
};

const glowTone: Record<StatTone, string> = {
  brand: "bg-brand-500/10",
  emerald: "bg-emerald-500/10",
  violet: "bg-violet-500/10",
  amber: "bg-amber-500/10",
  rose: "bg-rose-500/10",
  sky: "bg-sky-500/10",
  ink: "bg-ink-500/10",
  dark: "bg-brand-500/40",
};

/**
 * StatTile — icon chip + CountUp value + uppercase label.
 * `tone="dark"` renders the deep-navy branded variant.
 */
export function StatTile({
  label,
  value,
  countTo,
  prefix = "",
  suffix = "",
  decimals = 0,
  icon: Icon,
  tone = "brand",
  hint,
  loading = false,
  className,
}: {
  label: string;
  /** Preformatted value; ignored when `countTo` is set. */
  value?: React.ReactNode;
  /** Animate the number from 0 with CountUp. */
  countTo?: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  icon?: LucideIcon;
  tone?: StatTone;
  /** Small line under the value (delta, caption…). */
  hint?: React.ReactNode;
  loading?: boolean;
  className?: string;
}) {
  const dark = tone === "dark";

  if (loading) {
    return (
      <div
        className={cn(
          "rounded-2xl border border-ink-100 bg-white p-4 shadow-sm",
          className
        )}
      >
        <Skeleton className="h-10 w-10 rounded-xl" />
        <Skeleton className="mt-3 h-3 w-20" />
        <Skeleton className="mt-2 h-6 w-28" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group/stat relative overflow-hidden rounded-2xl p-4 transition-all duration-200",
        dark
          ? "bg-[#0b1030] text-white shadow-glow"
          : "border border-ink-100 bg-white shadow-sm hover:shadow-soft",
        className
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full blur-2xl transition-opacity duration-300",
          glowTone[tone],
          dark ? "opacity-100" : "opacity-0 group-hover/stat:opacity-100"
        )}
        aria-hidden
      />
      {Icon && (
        <span
          className={cn(
            "relative grid h-10 w-10 place-items-center rounded-xl",
            dark
              ? "bg-white/10 text-accent-300 ring-1 ring-white/15"
              : cn("bg-gradient-to-br text-white shadow-soft", chipTone[tone])
          )}
        >
          <Icon className="h-[18px] w-[18px]" />
        </span>
      )}
      <p
        className={cn(
          "relative mt-3 text-[11px] font-semibold uppercase tracking-widest",
          dark ? "text-white/60" : "text-ink-500"
        )}
      >
        {label}
      </p>
      <p
        className={cn(
          "relative mt-0.5 font-display text-xl font-bold",
          dark ? "text-white" : "text-ink-900"
        )}
      >
        {typeof countTo === "number" ? (
          <CountUp
            value={countTo}
            prefix={prefix}
            suffix={suffix}
            decimals={decimals}
            duration={1.1}
          />
        ) : (
          value
        )}
      </p>
      {hint && (
        <div
          className={cn(
            "relative mt-1 text-xs",
            dark ? "text-white/60" : "text-ink-500"
          )}
        >
          {hint}
        </div>
      )}
    </div>
  );
}
