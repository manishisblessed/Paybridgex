import pino from "pino";

/**
 * Structured application logger (pino). One JSON line per event so logs can be
 * shipped to CloudWatch / an SIEM and queried. Never log secrets, raw PII, full
 * card/account numbers, passwords, OTPs or tokens — mask before logging.
 *
 * Use the `security` child logger for auth / authorization / anomaly events so
 * they can be filtered with `category=security`.
 */
const level = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug");

export const logger = pino({
  level,
  base: { service: "paybridgex" },
  redact: {
    paths: [
      "password",
      "passwordHash",
      "*.password",
      "*.passwordHash",
      "token",
      "*.token",
      "tempToken",
      "otp",
      "code",
      "twoFactorSecret",
      "accountNumber",
      "aadhaar",
    ],
    censor: "[redacted]",
  },
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});

/** Child logger for security-relevant events (auth, authz, anomaly, abuse). */
export const securityLogger = logger.child({ category: "security" });
