import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  // 100% traces in dev, 10% in production.
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // Structured logs via Sentry.logger.*.
  enableLogs: true,

  environment: process.env.NODE_ENV,
  release: process.env.SENTRY_RELEASE,

  sendDefaultPii: false,
});
