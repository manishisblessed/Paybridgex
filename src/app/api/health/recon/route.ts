import { NextResponse } from "next/server";
import { checkReconFreshness } from "@/lib/recon/heartbeat";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * GET /api/health/recon
 *
 * Dead-man's-switch for the reconciliation worker, served by the always-on
 * Next.js server. Point an external uptime monitor at this: it returns 503 the
 * moment any enabled rail's sweep goes stale — including the case a worker-side
 * heartbeat can never catch (a fully dead worker, where the heartbeat job itself
 * would never fire).
 *
 * DELIBERATELY separate from /api/healthz: worker liveness must NOT gate the web
 * app's load-balancer health, or a stalled worker would evict healthy web nodes.
 * No auth: the body carries only rail names + timestamps (no financial data).
 */
export async function GET() {
  try {
    const freshness = await checkReconFreshness();
    return NextResponse.json(freshness, { status: freshness.healthy ? 200 : 503 });
  } catch (e) {
    return NextResponse.json(
      { healthy: false, error: (e as Error).message, ranAt: new Date().toISOString() },
      { status: 503 }
    );
  }
}
