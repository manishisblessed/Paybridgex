import * as React from "react";
import { cn } from "@/lib/utils";

type StaggerProps = Omit<React.HTMLAttributes<HTMLDivElement>, "children"> & {
  children?: React.ReactNode;
  /** Stagger gap between children, seconds. Default 0.08. */
  stagger?: number;
  /** Delay before the first child animates, seconds. Default 0. */
  delayChildren?: number;
  /** @deprecated Kept for API compatibility — no longer viewport-gated. */
  amount?: number;
  /** @deprecated Kept for API compatibility — animation runs once on mount. */
  once?: boolean;
};

/**
 * Reveals its children in sequence on mount.
 *
 * Orchestration is done by handing each `StaggerItem` an incremental
 * `--reveal-delay` (via its `delay` prop) so the whole effect is pure CSS and
 * runs on first paint without waiting for hydration. Non-`StaggerItem` children
 * are passed through untouched.
 */
export function Stagger({
  children,
  stagger = 0.08,
  delayChildren = 0,
  once,
  amount,
  className,
  ...rest
}: StaggerProps) {
  void once;
  void amount;

  let index = 0;
  const items = React.Children.map(children, (child) => {
    if (React.isValidElement(child) && child.type === StaggerItem) {
      const delay = delayChildren + index * stagger;
      index += 1;
      const el = child as React.ReactElement<StaggerItemProps>;
      return React.cloneElement(el, { delay: (el.props.delay ?? 0) + delay });
    }
    return child;
  });

  return (
    <div className={className} {...rest}>
      {items}
    </div>
  );
}

type StaggerItemProps = Omit<React.HTMLAttributes<HTMLDivElement>, "children"> & {
  children?: React.ReactNode;
  /** Travel distance in px. Default 24. */
  distance?: number;
  /** Direction of entry. Default "up". */
  direction?: "up" | "down" | "left" | "right";
  /** Duration in seconds. Default 0.55. */
  duration?: number;
  /** Delay in seconds. Normally injected by the parent `Stagger`. */
  delay?: number;
};

function offset(direction: "up" | "down" | "left" | "right", distance: number) {
  switch (direction) {
    case "up":
      return { x: 0, y: distance };
    case "down":
      return { x: 0, y: -distance };
    case "left":
      return { x: distance, y: 0 };
    case "right":
      return { x: -distance, y: 0 };
  }
}

export function StaggerItem({
  children,
  distance = 24,
  direction = "up",
  duration = 0.55,
  delay = 0,
  className,
  style,
  ...rest
}: StaggerItemProps) {
  const off = offset(direction, distance);

  return (
    <div
      className={cn("pbx-reveal", className)}
      style={
        {
          "--reveal-x": `${off.x}px`,
          "--reveal-y": `${off.y}px`,
          "--reveal-delay": `${delay}s`,
          "--reveal-duration": `${duration}s`,
          ...style,
        } as React.CSSProperties
      }
      {...rest}
    >
      {children}
    </div>
  );
}
