import * as Sentry from "@sentry/nextjs";

/**
 * Node-only startup logic. This module is imported *dynamically* and only from
 * the `NEXT_RUNTIME === "nodejs"` branch of `register()` so that webpack's Edge
 * compilation dead-code-eliminates the import and never traces the partner
 * adapters (which pull in Node's `crypto`) into the Edge bundle.
 *
 * Startup tripwire: in production, no money-moving rail (upi/payout/aeps/dmt/bbps)
 * may resolve to a MOCK adapter — that is exactly how phantom wallet balance got
 * minted (a mock UPI collector reported "PAID" without any real money). If any
 * money rail is on mock at boot, scream loudly (Sentry + logs) so the deploy is
 * fixed before it can move fake money. Non-fatal by design: the per-rail
 * `assertRealMoneyProvider` guards already block the actual money movement, so
 * the app still serves read-only traffic while ops corrects the config.
 */
export async function assertMoneyRailsAreLive(): Promise<void> {
  try {
    const { isProd } = await import("./lib/env");
    if (!isProd) return; // mocks are expected in dev/staging
    const { moneyRailsOnMock } = await import("./lib/partners");
    const onMock = moneyRailsOnMock();
    if (onMock.length === 0) return;

    const msg = `CRITICAL: money rails running on MOCK in production: ${onMock.join(", ")}`;
    // eslint-disable-next-line no-console
    console.error(`[startup] ${msg}`);
    Sentry.captureMessage(msg, { level: "fatal", tags: { area: "money-rails" } });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[startup] money-rail tripwire failed to run:", err);
  }
}
