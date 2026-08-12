import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // 100% traces in dev, 10% in production.
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // Structured logs via Sentry.logger.* (also captures console.* via logging setup).
  enableLogs: true,

  // Session Replay is intentionally left off: this is a KYC/PII fintech surface and
  // Replay needs deliberate masking + a `worker-src blob:` CSP relaxation first.

  environment: process.env.NODE_ENV,
});

// Capture App Router client-side navigation transitions as spans.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
