import Link from "next/link";
import { cn } from "@/lib/utils";

export function LogoMark({
  className,
  size = 36
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={cn("shrink-0 drop-shadow-[0_8px_20px_rgba(26,26,46,0.35)] transition-transform group-hover:scale-105", className)}
      role="img"
      aria-label="NextGenPay logo"
    >
      <defs>
        <linearGradient id="ngpBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1a1a2e" />
          <stop offset="55%" stopColor="#16213e" />
          <stop offset="100%" stopColor="#0f3460" />
        </linearGradient>
        <linearGradient id="ngpBolt" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#e94560" />
          <stop offset="100%" stopColor="#d4a843" />
        </linearGradient>
        <linearGradient id="ngpShine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.18" />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="ngpGlow" cx="0.3" cy="0.3" r="0.7">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#ngpBg)" />
      <rect width="64" height="64" rx="14" fill="url(#ngpGlow)" />
      <rect width="64" height="64" rx="14" fill="url(#ngpShine)" />
      {/* NextGenPay brand mark (client-provided), centered in badge */}
      <g transform="translate(15 20.3) scale(1.0625)">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M0.00172773 0V6.85398C0.00172773 6.85398 -0.133178 9.01207 1.98092 10.8388L13.6912 21.9964L19.7809 21.9181L18.8042 9.88248L16.4951 7.17289L9.23799 0H0.00172773Z"
          fill="url(#ngpBolt)"
        />
        <path
          opacity="0.08"
          fillRule="evenodd"
          clipRule="evenodd"
          d="M7.69824 16.4364L12.5199 3.23696L16.5541 7.25596L7.69824 16.4364Z"
          fill="#000000"
        />
        <path
          opacity="0.08"
          fillRule="evenodd"
          clipRule="evenodd"
          d="M8.07751 15.9175L13.9419 4.63989L16.5849 7.28475L8.07751 15.9175Z"
          fill="#000000"
        />
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M7.77295 16.3566L23.6563 0H32V6.88383C32 6.88383 31.8262 9.17836 30.6591 10.4057L19.7824 22H13.6938L7.77295 16.3566Z"
          fill="#ffffff"
        />
      </g>
    </svg>
  );
}

export function Logo({
  className,
  variant = "dark",
  showTagline = true
}: {
  className?: string;
  variant?: "dark" | "light";
  showTagline?: boolean;
}) {
  return (
    <Link
      href="/"
      className={cn("group inline-flex items-center gap-3", className)}
      aria-label="NextGenPay home"
    >
      <LogoMark size={40} />
      <span className="flex flex-col leading-tight">
        <span
          className={cn(
            "font-display text-[17px] font-extrabold tracking-tight",
            variant === "light" ? "text-white" : "text-ink-900"
          )}
        >
          NextGen
          <span
            className={cn(
              "bg-gradient-to-r bg-clip-text text-transparent",
              variant === "light"
                ? "from-rose-300 to-amber-200"
                : "from-accent-500 to-amber-500"
            )}
          >
            Pay
          </span>
        </span>
        {showTagline ? (
          <span
            className={cn(
              "text-[10px] font-semibold uppercase tracking-[0.22em]",
              variant === "light" ? "text-white/70" : "text-ink-500"
            )}
          >
            PG · POS · QR Payments
          </span>
        ) : null}
      </span>
    </Link>
  );
}
