"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type TabItem = {
  key: string;
  label: React.ReactNode;
  icon?: LucideIcon;
  count?: number;
};

const uid = () => Math.random().toString(36).slice(2, 9);

/**
 * TabNav — presentational tab strip with an animated brand underline.
 * Pages keep their own active-tab state; this only renders and calls back.
 */
export function TabNav({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: TabItem[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const layoutId = React.useRef(`tab-underline-${uid()}`);

  return (
    <div
      role="tablist"
      className={cn(
        "flex items-end gap-1 overflow-x-auto border-b border-ink-100",
        className
      )}
    >
      {tabs.map((t) => {
        const isActive = t.key === active;
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.key)}
            className={cn(
              "relative inline-flex shrink-0 items-center gap-1.5 rounded-t-xl px-4 py-2.5 text-sm font-semibold transition-colors duration-150",
              isActive
                ? "text-brand-700"
                : "text-ink-500 hover:bg-ink-50 hover:text-ink-800"
            )}
          >
            {Icon && <Icon className="h-4 w-4" />}
            {t.label}
            {typeof t.count === "number" && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                  isActive
                    ? "bg-brand-100 text-brand-700"
                    : "bg-ink-100 text-ink-500"
                )}
              >
                {t.count}
              </span>
            )}
            {isActive && (
              <motion.span
                layoutId={layoutId.current}
                transition={
                  reduce
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 500, damping: 40 }
                }
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-brand-500 to-accent-500"
                aria-hidden
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * SegmentedNav — pill-style segmented control (alternative to TabNav for
 * compact toggles) with an animated active pill.
 */
export function SegmentedNav({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: TabItem[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const layoutId = React.useRef(`seg-pill-${uid()}`);

  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-ink-100 bg-ink-50/70 p-1",
        className
      )}
    >
      {tabs.map((t) => {
        const isActive = t.key === active;
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.key)}
            className={cn(
              "relative inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors duration-150",
              isActive ? "text-white" : "text-ink-600 hover:text-ink-900"
            )}
          >
            {isActive && (
              <motion.span
                layoutId={layoutId.current}
                transition={
                  reduce
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 500, damping: 40 }
                }
                className="absolute inset-0 rounded-full bg-gradient-to-r from-brand-600 to-brand-500 shadow-soft"
                aria-hidden
              />
            )}
            <span className="relative inline-flex items-center gap-1.5">
              {Icon && <Icon className="h-3.5 w-3.5" />}
              {t.label}
              {typeof t.count === "number" && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-px text-[10px] font-bold",
                    isActive
                      ? "bg-white/20 text-white"
                      : "bg-ink-100 text-ink-500"
                  )}
                >
                  {t.count}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
