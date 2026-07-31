/**
 * Static security headers applied to every response.
 *
 * NOTE: Content-Security-Policy is intentionally NOT set here. It is generated
 * per-request with a fresh nonce in `src/middleware.ts` (nonce-based CSP), which
 * lets us drop script-src 'unsafe-inline'. Defining it here too would create a
 * conflicting second policy, so the dynamic one is the single source of truth.
 */
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

export default nextConfig;
