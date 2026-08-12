import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { MAX_BODY_BYTES } from "@/lib/env";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Content-Security-Policy applied to every document response.
 *
 * Uses 'unsafe-inline' for script-src because Next.js 14.x does not reliably
 * propagate the x-nonce to every inline <script> it emits (bootstrap, data,
 * font-loader, etc.), causing the browser to block hydration entirely.
 *
 * TODO: migrate to nonce-based CSP once upgraded to Next.js 15+ which has
 * first-class nonce support via the `experimental.serverActions.nonce` flag.
 *
 * Cloudflare Turnstile (CAPTCHA) is explicitly allowlisted for script/frame/
 * connect so it works when SECURITY_CAPTCHA_ENABLED is on.
 */
function buildCsp(): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://res.cloudinary.com https://api.qrserver.com https://images.unsplash.com https://api.dicebear.com https://logo.clearbit.com",
    "font-src 'self' data:",
    "connect-src 'self' https://challenges.cloudflare.com https://ip-api.com https://api.cloudinary.com https://*.amazonaws.com",
    "frame-src 'self' https://challenges.cloudflare.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

const ADMIN_PATHS: Array<{ prefix: string; roles: string[] }> = [
  { prefix: "/dashboard/master-admin", roles: ["MASTER_ADMIN"] },
  { prefix: "/dashboard/sub-admin", roles: ["SUPPORT", "MASTER_ADMIN"] },
  // FINANCE gets read access to the admin area; write APIs enforce their own
  // stricter role checks (FINANCE is never accepted on mutating endpoints).
  { prefix: "/dashboard/admin", roles: ["MASTER_ADMIN", "ADMIN", "SUPPORT", "FINANCE"] },
];

/** BBPS bill-pay pages: only RETAILER can access. */
const BBPS_PATHS: Array<{ prefix: string; roles: string[] }> = [
  { prefix: "/dashboard/bill-pay", roles: ["RETAILER"] },
];

/** Payout consumer page: only network tiers (RT/DT/MD/SD) can access.
 *  Note: /dashboard/payout-approvals is a separate path and is NOT blocked. */
const PAYOUT_PATHS: Array<{ prefix: string; roles: string[] }> = [
  { prefix: "/dashboard/payout", roles: ["RETAILER", "DISTRIBUTOR", "MASTER_DISTRIBUTOR", "SUPER_DISTRIBUTOR"] },
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── 1. Request-size limit on mutating API calls (defense vs oversized bodies)
  if (pathname.startsWith("/api/") && ["POST", "PUT", "PATCH"].includes(req.method)) {
    const len = Number(req.headers.get("content-length") ?? 0);
    if (Number.isFinite(len) && len > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "Request body too large" },
        { status: 413 }
      );
    }
  }

  // ── 2. CSP header
  const csp = buildCsp();

  const requestHeaders = new Headers(req.headers);

  // ── 3. Auth gate for dashboard routes (replaces withAuth wrapper so we keep
  //       full control of the response headers).
  if (pathname.startsWith("/dashboard")) {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    if (!token) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(url);
    }
    const role = (token.role as string) ?? "";
    const rule = ADMIN_PATHS.find((r) => pathname.startsWith(r.prefix));
    if (rule && !rule.roles.includes(role)) {
      const url = req.nextUrl.clone();
      url.pathname = "/dashboard";
      url.search = "";
      return NextResponse.redirect(url);
    }

    // BBPS pages: RETAILER-only (/dashboard/bill-pay/*)
    const bbpsRule = BBPS_PATHS.find((r) => pathname.startsWith(r.prefix));
    if (bbpsRule && !bbpsRule.roles.includes(role)) {
      const url = req.nextUrl.clone();
      url.pathname = "/dashboard";
      url.search = "";
      return NextResponse.redirect(url);
    }

    // Payout consumer page: network roles only (/dashboard/payout but NOT
    // /dashboard/payout-approvals which admins need).
    if (pathname.startsWith("/dashboard/payout") && !pathname.startsWith("/dashboard/payout-approvals")) {
      const payoutRule = PAYOUT_PATHS[0];
      if (!payoutRule.roles.includes(role)) {
        const url = req.nextUrl.clone();
        url.pathname = "/dashboard";
        url.search = "";
        return NextResponse.redirect(url);
      }
    }

    // Settlements (partner-wallet bank transfers) are a money movement admins
    // must not perform. Blocked for everyone. Note: "/dashboard/admin/settlements"
    // does not match "/dashboard/admin/settlement-ops" or ".../pos-settlement".
    if (pathname.startsWith("/dashboard/admin/settlements")) {
      const url = req.nextUrl.clone();
      url.pathname = "/dashboard";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("content-security-policy", csp);

  // ── 4. Anti cache-deception / poisoning / replay.
  //       No cache (browser, nginx, CDN) may ever store authenticated HTML or
  //       API responses. Scoped to /dashboard and /api only — /_next/static,
  //       /_next/image and public assets are already excluded by the matcher,
  //       so their long-lived immutable caching is untouched.
  if (pathname.startsWith("/dashboard") || pathname.startsWith("/api")) {
    // Server-Sent Events endpoints MUST keep `no-transform`, otherwise a
    // compression/proxy layer (Next's built-in gzip in production, nginx, a CDN)
    // buffers the `text/event-stream` and holds each frame back until the
    // connection closes — which breaks the live push (the feed then only
    // "refreshes" on reconnect / tab-switch). The stream route sets this header
    // itself; we must not clobber it here.
    const isEventStream = req.headers.get("accept") === "text/event-stream";
    res.headers.set(
      "Cache-Control",
      isEventStream
        ? "no-store, no-cache, no-transform, must-revalidate, private"
        : "no-store, no-cache, must-revalidate, private"
    );
    res.headers.set("Pragma", "no-cache");
    res.headers.set("Expires", "0");
    // Caches that key on the response must vary by the auth cookie so a shared
    // cache can never serve one user's authenticated response to another.
    res.headers.set("Vary", "Cookie");
    // Belt-and-suspenders: disable nginx/proxy response buffering for the stream.
    if (isEventStream) res.headers.set("X-Accel-Buffering", "no");
  }

  return res;
}

export const config = {
  // Run on everything except static assets so the CSP applies to all documents.
  matcher: [
    "/((?!monitoring|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|map|woff2?)$).*)",
  ],
};
