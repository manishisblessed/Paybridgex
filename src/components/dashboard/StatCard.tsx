"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { CountUp } from "@/components/motion";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  delta,
  trend = "up",
  icon: Icon,
  accent = "brand",
  href,
  countTo,
  prefix = "",
  suffix = "",
  decimals = 0,
}: {
  label: string;
  value: string;
  delta?: string;
  trend?: "up" | "down";
  icon: LucideIcon;
  accent?: "brand" | "accent" | "emerald" | "violet";
  href?: string;
  /** When set, the number animates from 0 with CountUp instead of showing `value`. */
  countTo?: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
}) {
  const accents: Record<string, string> = {
    brand: "from-brand-500 to-brand-700",
    accent: "from-accent-500 to-accent-700",
    emerald: "from-emerald-500 to-emerald-700",
    violet: "from-violet-500 to-violet-700"
  };
  const glows: Record<string, string> = {
    brand: "bg-brand-500/10",
    accent: "bg-accent-500/10",
    emerald: "bg-emerald-500/10",
    violet: "bg-violet-500/10"
  };

  const card = (
    <div
      className={cn(
        "group/stat relative overflow-hidden rounded-2xl border border-ink-100 bg-white p-4 shadow-sm transition-all duration-200",
        href
          ? "cursor-pointer hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-soft"
          : "hover:shadow-soft"
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full blur-2xl transition-opacity duration-300 opacity-0 group-hover/stat:opacity-100",
          glows[accent]
        )}
        aria-hidden
      />
      <div className="relative flex items-start justify-between">
        <span
          className={cn(
            "grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br text-white shadow-soft",
            accents[accent]
          )}
        >
          <Icon className="h-[18px] w-[18px]" />
        </span>
        {delta && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
              trend === "up"
                ? "bg-emerald-50 text-emerald-700"
                : "bg-rose-50 text-rose-700"
            )}
          >
            {trend === "up" ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : (
              <ArrowDownRight className="h-3 w-3" />
            )}
            {delta}
          </span>
        )}
      </div>
      <p className="relative mt-3 text-[11px] font-semibold uppercase tracking-widest text-ink-500">
        {label}
      </p>
      <p className="relative mt-0.5 font-display text-xl font-bold text-ink-900">
        {typeof countTo === "number" ? (
          <CountUp value={countTo} prefix={prefix} suffix={suffix} decimals={decimals} duration={1.1} />
        ) : (
          value
        )}
      </p>
    </div>
  );

  if (href) {
    return <Link href={href}>{card}</Link>;
  }

  return card;
}
