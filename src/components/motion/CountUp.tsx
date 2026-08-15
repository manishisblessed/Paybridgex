"use client";

import { animate, useInView, useReducedMotion } from "framer-motion";
import * as React from "react";

type CountUpProps = {
  /** Final value to count to. */
  value: number;
  /** Text before the number (e.g. "₹"). */
  prefix?: string;
  /** Text after the number (e.g. "+", " Cr"). */
  suffix?: string;
  /** Seconds. Default 1.6. */
  duration?: number;
  /** Decimal places. Default 0. */
  decimals?: number;
  className?: string;
};

/** Number that counts up from 0 when it scrolls into view. */
export function CountUp({
  value,
  prefix = "",
  suffix = "",
  duration = 1.6,
  decimals = 0,
  className
}: CountUpProps) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduce = useReducedMotion();

  React.useEffect(() => {
    const el = ref.current;
    if (!el || !inView) return;
    if (reduce) {
      el.textContent = `${prefix}${value.toLocaleString("en-IN", { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}${suffix}`;
      return;
    }
    const controls = animate(0, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => {
        el.textContent = `${prefix}${v.toLocaleString("en-IN", { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}${suffix}`;
      }
    });
    return () => controls.stop();
  }, [inView, value, prefix, suffix, duration, decimals, reduce]);

  return (
    <span ref={ref} className={className}>
      {prefix}0{suffix}
    </span>
  );
}
