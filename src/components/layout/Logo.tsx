import Link from "next/link";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { company } from "@/lib/data";

/**
 * Official K.A. Paybridgex emblem — the circular blue-green mark with the
 * "K.A." monogram, shield-check and suspension bridge.
 *
 * `variant="dark"` (default) is the artwork for light backgrounds;
 * `variant="light"` is the brighter version drawn for dark backgrounds.
 */
export function LogoMark({
  className,
  size = 32,
  variant = "dark"
}: {
  className?: string;
  size?: number;
  variant?: "dark" | "light";
}) {
  return (
    <Image
      src={variant === "light" ? "/brand-mark-dark.png" : "/brand-mark.png"}
      alt="Paybridgex logo"
      width={size}
      height={size}
      priority
      className={cn(
        "shrink-0 object-contain transition-transform group-hover:scale-105",
        className
      )}
    />
  );
}

export function Logo({
  className,
  variant = "dark",
  iconOnly = false,
  withTagline = false
}: {
  className?: string;
  variant?: "dark" | "light";
  iconOnly?: boolean;
  withTagline?: boolean;
}) {
  return (
    <Link
      href="/"
      className={cn("group inline-flex items-center gap-2.5", className)}
      aria-label="Paybridgex home"
    >
      <LogoMark size={iconOnly ? 32 : 40} variant={variant} />
      {!iconOnly && (
        <span className="flex flex-col leading-none">
          <span className="font-display text-[20px] font-extrabold tracking-tight">
            <span className={variant === "light" ? "text-white" : "text-brand-700"}>
              Pay
            </span>
            <span className={variant === "light" ? "text-accent-400" : "text-accent-600"}>
              bridgex
            </span>
          </span>
          {withTagline && (
            <span
              className={cn(
                "mt-1 text-[9px] font-semibold uppercase tracking-[0.14em]",
                variant === "light" ? "text-white/60" : "text-ink-500"
              )}
            >
              {company.tagline}
            </span>
          )}
        </span>
      )}
    </Link>
  );
}
