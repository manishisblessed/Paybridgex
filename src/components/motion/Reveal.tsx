import * as React from "react";
import { cn } from "@/lib/utils";

type Direction = "up" | "down" | "left" | "right" | "none";

type RevealProps = Omit<React.HTMLAttributes<HTMLElement>, "children"> & {
  children?: React.ReactNode;
  /** Direction the element travels from. Default "up". */
  direction?: Direction;
  /** Distance in px the element travels. Default 28. */
  distance?: number;
  /** Delay in seconds before this element animates. Default 0. */
  delay?: number;
  /** Duration in seconds. Default 0.6. */
  duration?: number;
  /** @deprecated Kept for API compatibility — animation now runs once on mount. */
  once?: boolean;
  /** @deprecated Kept for API compatibility — no longer viewport-gated. */
  amount?: number;
  /** Render as a specific element. Default "div". */
  as?: keyof React.JSX.IntrinsicElements;
};

function offset(direction: Direction, distance: number) {
  switch (direction) {
    case "up":
      return { x: 0, y: distance };
    case "down":
      return { x: 0, y: -distance };
    case "left":
      return { x: distance, y: 0 };
    case "right":
      return { x: -distance, y: 0 };
    default:
      return { x: 0, y: 0 };
  }
}

/**
 * Reveals its children with a fade + slide on mount.
 *
 * Implemented with a CSS animation (`.pbx-reveal`) rather than a JS motion
 * library so the reveal runs on the browser's first paint from server-rendered
 * HTML — content is never left invisible waiting for the page bundle to
 * hydrate. See `globals.css` for the keyframes.
 */
export function Reveal({
  children,
  direction = "up",
  distance = 28,
  delay = 0,
  duration = 0.6,
  // once / amount are accepted for backwards compatibility but no longer used:
  // the animation is a one-shot mount reveal, not viewport-gated.
  once,
  amount,
  as = "div",
  className,
  style,
  ...rest
}: RevealProps) {
  void once;
  void amount;
  const Tag = as as React.ElementType;
  const off = offset(direction, distance);

  return (
    <Tag
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
    </Tag>
  );
}
