import * as Sentry from "@sentry/nextjs";
import { logger } from "@/lib/logger";

/**
 * Operational alerting — pushes critical platform events to a webhook so an
 * operator hears about problems before users do. Works with any endpoint that
 * accepts a Slack-style `{ text }` JSON POST (Slack, Discord w/ /slack suffix,
 * Google Chat, or a custom receiver).
 *
 * Configure with ALERT_WEBHOOK_URL. When unset, alerts still land in the
 * structured log (pino → CloudWatch) under action="ops.alert" so nothing is
 * silently dropped.
 *
 * Rules:
 *  - NEVER throws — alerting must not break the money path it is reporting on.
 *  - NEVER include PII/secrets in alert text; pass identifiers, not payloads.
 */

export type OpsAlertSeverity = "info" | "warning" | "critical";

export type OpsAlert = {
  title: string;
  severity: OpsAlertSeverity;
  /** Key facts as label → value; rendered one per line. Keep it PII-free. */
  details?: Record<string, string | number | boolean | null | undefined>;
};

const SEVERITY_PREFIX: Record<OpsAlertSeverity, string> = {
  info: "[INFO]",
  warning: "[WARNING]",
  critical: "[CRITICAL]",
};

function formatAlertText(alert: OpsAlert): string {
  const lines = [`${SEVERITY_PREFIX[alert.severity]} NextGenPay — ${alert.title}`];
  for (const [key, value] of Object.entries(alert.details ?? {})) {
    if (value === undefined || value === null) continue;
    lines.push(`• ${key}: ${value}`);
  }
  lines.push(`• at: ${new Date().toISOString()}`);
  return lines.join("\n");
}

/** Fire an operational alert. Best-effort; safe to call from any code path. */
export async function sendOpsAlert(alert: OpsAlert): Promise<void> {
  const logPayload = {
    action: "ops.alert",
    severity: alert.severity,
    title: alert.title,
    ...alert.details,
  };
  if (alert.severity === "critical") logger.error(logPayload);
  else if (alert.severity === "warning") logger.warn(logPayload);
  else logger.info(logPayload);

  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: formatAlertText(alert) }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      logger.warn({ action: "ops.alert_delivery_failed", status: res.status });
    }
  } catch (err) {
    logger.warn({ action: "ops.alert_delivery_failed", err: String(err) });
  }
}

/**
 * Capture an unexpected error with context: structured log always, webhook
 * alert when critical. Use in workers/jobs where an uncaught error would
 * otherwise disappear into a retry loop.
 */
export async function captureError(
  err: unknown,
  context: { where: string; severity?: OpsAlertSeverity; meta?: Record<string, string | number> }
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({
    action: "error.captured",
    where: context.where,
    err: message,
    stack: err instanceof Error ? err.stack : undefined,
    ...context.meta,
  });
  const severity = context.severity ?? "warning";

  // Report to Sentry. Works in both runtimes: the Next.js server initializes the
  // SDK via instrumentation.ts, and the worker initializes @sentry/node at boot —
  // both register the same global client this call reads. `meta` is documented to
  // hold identifiers, not PII, so it is safe to attach as extra context.
  Sentry.captureException(err, {
    level: severity === "critical" ? "fatal" : severity === "warning" ? "warning" : "info",
    tags: { where: context.where },
    extra: context.meta,
  });

  if (severity !== "info") {
    await sendOpsAlert({
      title: `Error in ${context.where}`,
      severity,
      details: { error: message.slice(0, 300), ...context.meta },
    });
  }
}
