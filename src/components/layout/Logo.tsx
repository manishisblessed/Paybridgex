import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Client-provided brand mark. Monochrome, uses `currentColor` so it
 * adapts to the parent text color (accent on light, white on dark, etc).
 * Native aspect ratio is 32:22.
 */
export function LogoMark({
  className,
  size = 32
}: {
  className?: string;
  size?: number;
}) {
  const height = Math.round((size * 22) / 32);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 22"
      width={size}
      height={height}
      fill="none"
      className={cn(
        "shrink-0 transition-transform group-hover:scale-105",
        className
      )}
      role="img"
      aria-label="NextGenPay logo"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M0.00172773 0V6.85398C0.00172773 6.85398 -0.133178 9.01207 1.98092 10.8388L13.6912 21.9964L19.7809 21.9181L18.8042 9.88248L16.4951 7.17289L9.23799 0H0.00172773Z"
        fill="currentColor"
      />
      <path
        opacity="0.06"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M7.69824 16.4364L12.5199 3.23696L16.5541 7.25596L7.69824 16.4364Z"
        fill="#161616"
      />
      <path
        opacity="0.06"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8.07751 15.9175L13.9419 4.63989L16.5849 7.28475L8.07751 15.9175Z"
        fill="#161616"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M7.77295 16.3566L23.6563 0H32V6.88383C32 6.88383 31.8262 9.17836 30.6591 10.4057L19.7824 22H13.6938L7.77295 16.3566Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function Logo({
  className,
  variant = "dark",
  iconOnly = false,
}: {
  className?: string;
  variant?: "dark" | "light";
  iconOnly?: boolean;
}) {
  return (
    <Link
      href="/"
      className={cn("group inline-flex items-center gap-2.5", className)}
      aria-label="NextGenPay home"
    >
      <LogoMark size={iconOnly ? 28 : 34} className="text-[#7367F0]" />
      {!iconOnly && (
        <span
          className={cn(
            "font-display text-[20px] font-extrabold tracking-tight leading-none",
            variant === "light" ? "text-white" : "text-ink-900"
          )}
        >
          NextGenPay
        </span>
      )}
    </Link>
  );
}
