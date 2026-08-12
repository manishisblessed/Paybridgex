import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  // 100% traces in dev, 10% in production.
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // Structured logs via Sentry.logger.*.
  enableLogs: true,

  environment: process.env.NODE_ENV,
  release: process.env.SENTRY_RELEASE,

  // This is a KYC/PII fintech. Never auto-attach user identity, cookies, headers
  // or request bodies, and do NOT capture local variables (they hold account
  // numbers, tokens, Aadhaar/PAN). `includeLocalVariables` is intentionally off.
  sendDefaultPii: false,

  // Defensive scrub: strip any request cookies/auth headers that an integration
  // might attach before the event leaves the process.
  beforeSend(event) {
    if (event.request) {
      delete event.request.cookies;
      if (event.request.headers) {
        delete event.request.headers.cookie;
        delete event.request.headers.authorization;
      }
    }
    return event;
  },
});
