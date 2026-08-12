/**
 * Static security headers applied to every response.
 *
 * NOTE: Content-Security-Policy is intentionally NOT set here. It is generated
 * per-request with a fresh nonce in `src/middleware.ts` (nonce-based CSP), which
 * lets us drop script-src 'unsafe-inline'. Defining it here too would create a
 * conflicting second policy, so the dynamic one is the single source of truth.
 */
import { withSentryConfig } from "@sentry/nextjs";

const isProd = process.env.NODE_ENV === "production";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // camera/microphone MUST be (self): KYC selfie + liveness video use getUserMedia.
  // camera=() would hard-block the camera site-wide with no permission popup.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(self), payment=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  ...(isProd
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
  // pdfkit loads its built-in AFM font-data files from disk at runtime; bundling
  // it with webpack breaks those file reads, so keep it external on the server.
  experimental: { serverComponentsExternalPackages: ["pdfkit"] },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "api.dicebear.com" },
      { protocol: "https", hostname: "res.cloudinary.com" }
    ]
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async rewrites() {
    return [
      {
        source: "/dashboard/master-admin/:path*",
        destination: "/dashboard/admin/:path*",
      },
      {
        source: "/dashboard/sub-admin/:path*",
        destination: "/dashboard/admin/:path*",
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: "jmp-nextgenpay-private-limited",
  project: "javascript-nextjs",

  // Build-time secret used to upload source maps so production stack traces are
  // readable. Only needed at `next build`; leave unset in dev.
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Upload a wider set of client files for better client-side stack traces.
  widenClientFileUpload: true,

  // Route browser events through our own origin (/monitoring) so they aren't
  // blocked by ad-blockers or the strict `connect-src` CSP set in middleware.
  // NOTE: /monitoring is excluded from the middleware matcher.
  tunnelRoute: "/monitoring",

  // Only print SDK build output in CI.
  silent: !process.env.CI,
});
