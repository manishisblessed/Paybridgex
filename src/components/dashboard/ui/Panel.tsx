import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Panel — the standard light dashboard card.
 * Rounded-2xl, hairline ink border, soft shadow, optional hover lift.
 */
export const Panel = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    /** Adds a subtle lift + border tint on hover. */
    interactive?: boolean;
    /** Remove default padding (e.g. when the panel wraps a table). */
    flush?: boolean;
  }
>(({ className, interactive, flush, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "min-w-0 rounded-2xl border border-ink-100 bg-white shadow-sm",
      !flush && "p-5",
      interactive &&
        "transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-soft",
      className
    )}
    {...props}
  />
));
Panel.displayName = "Panel";

/**
 * DarkPanel — deep-navy branded surface with soft glow orbs,
 * matching the overview wallet cards.
 */
export const DarkPanel = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    flush?: boolean;
    /** Hide the decorative glow orbs. */
    plain?: boolean;
  }
>(({ className, flush, plain, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "relative min-w-0 overflow-hidden rounded-2xl bg-[#0b1030] text-white shadow-glow",
      !flush && "p-5",
      className
    )}
    {...props}
  >
    {!plain && (
      <>
        <div
          className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-brand-500/40 blur-2xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-12 -left-8 h-28 w-28 rounded-full bg-accent-500/25 blur-2xl"
          aria-hidden
        />
      </>
    )}
    <div className="relative">{children}</div>
  </div>
));
DarkPanel.displayName = "DarkPanel";
