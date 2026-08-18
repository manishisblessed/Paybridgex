import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
    // Node-only tripwire kept in a separate module so the Edge compilation
    // never traces the partner adapters (which import Node's `crypto`).
    const { assertMoneyRailsAreLive } = await import("./instrumentation.node");
    await assertMoneyRailsAreLive();
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

// Automatically capture all unhandled server-side request errors (App Router,
// route handlers, server actions). Requires @sentry/nextjs >= 8.28.0.
export const onRequestError = Sentry.captureRequestError;
