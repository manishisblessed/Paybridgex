/**
 * Recon heartbeat — a dead-man's-switch that proves the reconciliation sweeps
 * are actually RUNNING, not just registered.
 *
 * Each rail's sweep writes a completion marker to AuditLog when it finishes
 * (recon.bbps_recon / recon.rechargekit_recon / recon.payout_recon). If the
 * newest marker for an ENABLED rail is older than that rail's expected cadence,
 * the sweep has stalled (worker crash-loop, a throwing job blocking the queue,
 * a paused pg-boss schedule) and pending money is silently not settling.
 *
 * Two consumers share the same freshness check:
 *   - the worker runs `runReconHeartbeat()` every 15 min and fires a critical
 *     ops alert when a rail is stale (catches "worker alive but one queue
 *     wedged");
 *   - the always-on Next.js server exposes `checkReconFreshness()` via
 *     GET /api/health/recon so an EXTERNAL uptime monitor can catch the case a
 *     worker-side heartbeat cannot: a fully dead worker (where the heartbeat job
 *     itself would never fire).
 */
import { prisma } from "@/lib/db";
import { flags } from "@/lib/env";
import { sendOpsAlert } from "@/lib/monitoring/alerts";
import { logger } from "@/lib/logger";

const log = logger.child({ module: "recon/heartbeat" });

const MIN = 60_000;

type ReconMonitor = { rail: string; action: string; maxAgeMs: number; enabled: boolean };

/** Rails whose completion markers we watch, with their staleness budget. */
function monitors(): ReconMonitor[] {
  return [
    // 5-minute sweeps — allow a few missed ticks before crying wolf.
    { rail: "bbps", action: "recon.bbps_recon", maxAgeMs: 20 * MIN, enabled: flags.bbps },
    { rail: "rechargekit", action: "recon.rechargekit_recon", maxAgeMs: 20 * MIN, enabled: flags.rechargekit },
    // Deep payout recon runs daily; allow a little over a day.
    { rail: "payout", action: "recon.payout_recon", maxAgeMs: 26 * 60 * MIN, enabled: flags.payout },
  ].filter((m) => m.enabled);
}

export type RailFreshness = {
  rail: string;
  lastRanAt: string | null;
  ageMs: number | null;
  stale: boolean;
};

export type ReconFreshness = {
  ranAt: string;
  healthy: boolean;
  rails: RailFreshness[];
};

/**
 * Pure, side-effect-free freshness read (no alerts). Safe to call from the HTTP
 * health endpoint on every ping.
 */
export async function checkReconFreshness(): Promise<ReconFreshness> {
  const now = Date.now();
  const rails: RailFreshness[] = [];

  for (const m of monitors()) {
    const last = await prisma.auditLog.findFirst({
      where: { action: m.action },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    const ageMs = last ? now - last.createdAt.getTime() : null;
    const stale = ageMs === null ? true : ageMs > m.maxAgeMs;
    rails.push({
      rail: m.rail,
      lastRanAt: last ? last.createdAt.toISOString() : null,
      ageMs,
      stale,
    });
  }

  return {
    ranAt: new Date(now).toISOString(),
    healthy: rails.every((r) => !r.stale),
    rails,
  };
}

export type ReconHeartbeatResult = {
  ranAt: string;
  stale: string[];
  checked: number;
};

/**
 * Worker-side heartbeat: check freshness and fire a CRITICAL alert for any
 * stale rail. Never throws.
 */
export async function runReconHeartbeat(): Promise<ReconHeartbeatResult> {
  let freshness: ReconFreshness;
  try {
    freshness = await checkReconFreshness();
  } catch (e) {
    log.warn({ err: String(e) }, "recon heartbeat freshness check failed");
    return { ranAt: new Date().toISOString(), stale: [], checked: 0 };
  }

  const stale = freshness.rails.filter((r) => r.stale);

  if (stale.length > 0) {
    const details: Record<string, string> = {};
    for (const r of stale) {
      details[r.rail] = r.lastRanAt ? `last ran ${Math.round((r.ageMs ?? 0) / MIN)}m ago` : "never ran";
    }
    await sendOpsAlert({
      title: "Reconciliation sweep is not running — pending money is not settling",
      severity: "critical",
      details: {
        staleRails: stale.map((r) => r.rail).join(", "),
        ...details,
        impact: "Pending payouts / bill payments will not auto-settle until recon resumes",
      },
    });
    log.error({ action: "recon.heartbeat_stale", stale: stale.map((r) => r.rail) }, "recon heartbeat stale");
  }

  return {
    ranAt: freshness.ranAt,
    stale: stale.map((r) => r.rail),
    checked: freshness.rails.length,
  };
}
