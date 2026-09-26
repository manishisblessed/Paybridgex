/**
 * Recon preflight — a worker-boot self-check that proves the box can actually
 * REACH each enabled money provider's status API.
 *
 * Why this exists: reconciliation is worthless if the worker's egress IP is not
 * whitelisted at the provider — every status poll comes back "IP not authorized"
 * and pending payouts/bill payments silently never settle. That failure is
 * invisible per-transaction (the sweep just logs a poll failure and moves on).
 * Probing once at boot surfaces a whitelist lapse LOUDLY (critical ops alert)
 * the moment the worker starts, instead of after customers complain.
 *
 * The probe is READ-ONLY: it calls each rail's status endpoint with a sentinel
 * reference. A normal "not found / invalid reference" business error means
 * connectivity is fine (we reached the provider). Only an auth / IP / forbidden
 * / network error is treated as a connectivity block.
 */
import { prisma } from "@/lib/db";
import { flags } from "@/lib/env";
import { getPartner } from "@/lib/partners";
import { rechargekitConfigured, rechargekitStatus } from "@/lib/partners/sameday-rechargekit";
import { samedayBbpsConfigured } from "@/lib/partners/sameday-bbps";
import { sendOpsAlert } from "@/lib/monitoring/alerts";
import { logger } from "@/lib/logger";

const log = logger.child({ module: "recon/preflight" });

/** Sentinel reference used for the read-only connectivity probe. */
const PROBE_REF = "PREFLIGHT_PROBE_DO_NOT_SETTLE";

/**
 * AuditLog action that records every connectivity probe (boot + periodic). This
 * is the durable history the mid-run monitor diffs against to fire alerts only
 * on state CHANGES (down / recovered), and the trail an operator can inspect to
 * see exactly when a provider's status API dropped and came back.
 */
export const CONNECTIVITY_ACTION = "recon.connectivity_probe";

/**
 * True when a partner error indicates the worker cannot talk to the provider
 * (IP not whitelisted, auth rejected, forbidden, or the host is unreachable) —
 * as opposed to an ordinary "unknown reference" business error, which proves
 * connectivity is healthy.
 */
export function isConnectivityBlock(code?: string | null, message?: string | null): boolean {
  const c = (code || "").toUpperCase();
  const m = (message || "").toLowerCase();
  if (["UNAUTHORIZED", "FORBIDDEN", "HTTP_401", "HTTP_403", "NETWORK"].includes(c)) return true;
  return /not authorized|whitelist|ip address|forbidden|unauthor/.test(m);
}

export type RailProbe = {
  rail: string;
  reachable: boolean;
  blocked: boolean;
  code?: string;
  message?: string;
};

export type ReconPreflightResult = {
  ranAt: string;
  probed: RailProbe[];
  blocked: string[];
};

async function probeBbps(): Promise<RailProbe | null> {
  if (!flags.bbps || !samedayBbpsConfigured()) return null;
  const bbps = getPartner("bbps");
  if (!bbps.status) return null;
  try {
    const r = await bbps.status({ orderId: PROBE_REF });
    if (r.ok) return { rail: "bbps", reachable: true, blocked: false };
    const blocked = isConnectivityBlock(r.code, r.message);
    return { rail: "bbps", reachable: !blocked, blocked, code: r.code, message: r.message };
  } catch (e) {
    return { rail: "bbps", reachable: false, blocked: true, code: "EXCEPTION", message: (e as Error).message };
  }
}

async function probeRechargekit(): Promise<RailProbe | null> {
  if (!flags.rechargekit || !rechargekitConfigured()) return null;
  try {
    const r = await rechargekitStatus({ txnId: PROBE_REF });
    if (r.ok) return { rail: "rechargekit", reachable: true, blocked: false };
    const blocked = isConnectivityBlock(r.code, r.message);
    return { rail: "rechargekit", reachable: !blocked, blocked, code: r.code, message: r.message };
  } catch (e) {
    return { rail: "rechargekit", reachable: false, blocked: true, code: "EXCEPTION", message: (e as Error).message };
  }
}

async function probePayout(): Promise<RailProbe | null> {
  if (!flags.payout) return null;
  const payout = getPartner("payout");
  try {
    const r = await payout.status(PROBE_REF);
    if (r.ok) return { rail: "payout", reachable: true, blocked: false };
    const blocked = isConnectivityBlock(r.code, r.message);
    return { rail: "payout", reachable: !blocked, blocked, code: r.code, message: r.message };
  } catch (e) {
    return { rail: "payout", reachable: false, blocked: true, code: "EXCEPTION", message: (e as Error).message };
  }
}

/** Probe every enabled money rail's status API. Never throws. */
async function probeAllRails(): Promise<{ probed: RailProbe[]; blocked: string[] }> {
  let probes: (RailProbe | null)[] = [];
  try {
    probes = await Promise.all([probeBbps(), probeRechargekit(), probePayout()]);
  } catch (e) {
    log.warn({ err: String(e) }, "recon connectivity probe batch failed");
  }
  const probed = probes.filter((p): p is RailProbe => p !== null);
  const blocked = probed.filter((p) => p.blocked).map((p) => p.rail);
  return { probed, blocked };
}

/**
 * Record a probe result to AuditLog so we keep a durable, queryable history of
 * every connectivity check (and never lose the data point that tells us when a
 * provider dropped). Best-effort — never throws.
 */
async function recordProbe(ranAt: string, probed: RailProbe[], blocked: string[]): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: CONNECTIVITY_ACTION,
        entity: "System",
        meta: {
          ranAt,
          blocked,
          probed: probed.map((p) => ({ rail: p.rail, blocked: p.blocked, code: p.code ?? null })),
        },
      },
    });
  } catch (e) {
    log.warn({ err: String(e) }, "connectivity monitor: could not record probe");
  }
}

/** Read the `blocked` rail set from the most recent recorded probe. */
async function lastRecordedBlocked(): Promise<string[]> {
  try {
    const last = await prisma.auditLog.findFirst({
      where: { action: CONNECTIVITY_ACTION },
      orderBy: { createdAt: "desc" },
      select: { meta: true },
    });
    const meta = last?.meta as { blocked?: unknown } | null;
    if (meta && Array.isArray(meta.blocked)) {
      return meta.blocked.filter((x): x is string => typeof x === "string");
    }
  } catch (e) {
    log.warn({ err: String(e) }, "connectivity monitor: could not read previous probe");
  }
  return [];
}

/**
 * Probe every enabled money rail's status API and alert (critical) if any is
 * unreachable/blocked. Never throws — a preflight hiccup must not stop the
 * worker from booting (the sweeps still run; they just log poll failures).
 *
 * Also seeds the durable probe history so the periodic monitor
 * (`runReconConnectivityMonitor`) has a baseline and never re-alerts for a block
 * already present at boot.
 */
export async function runReconPreflight(): Promise<ReconPreflightResult> {
  const ranAt = new Date().toISOString();
  const { probed, blocked } = await probeAllRails();

  for (const p of probed) {
    log.info({ action: "recon.preflight_probe", ...p }, `preflight ${p.rail}: ${p.blocked ? "BLOCKED" : "ok"}`);
  }

  await recordProbe(ranAt, probed, blocked);

  if (blocked.length > 0) {
    await sendOpsAlert({
      title: "Recon worker CANNOT reach a payment provider (IP whitelist / auth)",
      severity: "critical",
      details: {
        blockedRails: blocked.join(", "),
        impact: "Pending payouts/bill payments will NOT auto-settle until connectivity is restored",
        hint: "Whitelist this worker's egress IP at the provider, or check API key/secret",
      },
    });
  }

  return { ranAt, probed, blocked };
}

export type ReconConnectivityResult = {
  ranAt: string;
  probed: RailProbe[];
  blocked: string[];
  newlyBlocked: string[];
  recovered: string[];
};

/**
 * Mid-operation connectivity monitor. The boot preflight only proves reachability
 * ONCE at startup; a provider status API can go dark WHILE the worker keeps
 * running (e.g. the provider revokes/forbids the status endpoint, or the egress
 * IP falls off a whitelist). When that happens the sweeps still "succeed" — they
 * just poll, get FORBIDDEN, and silently settle nothing — so the heartbeat stays
 * green while pending money quietly stops reconciling.
 *
 * This job re-runs the same read-only probes on a schedule and diffs the result
 * against the last recorded probe, firing an alert only on a STATE CHANGE:
 *   - a rail that just became unreachable  → CRITICAL (recon is now blind here)
 *   - a rail that just recovered           → WARNING  (recon will resume)
 * Every probe is recorded to AuditLog regardless, so the outage window is fully
 * captured. Never throws.
 */
export async function runReconConnectivityMonitor(): Promise<ReconConnectivityResult> {
  const ranAt = new Date().toISOString();

  // Read the previous state BEFORE recording this one, so the diff is against
  // the prior tick (or the boot preflight's seed row).
  const prevBlocked = await lastRecordedBlocked();
  const { probed, blocked } = await probeAllRails();

  for (const p of probed) {
    log.info(
      { action: CONNECTIVITY_ACTION, ...p },
      `connectivity ${p.rail}: ${p.blocked ? "BLOCKED" : "ok"}`
    );
  }

  await recordProbe(ranAt, probed, blocked);

  const prevSet = new Set(prevBlocked);
  const currSet = new Set(blocked);
  const newlyBlocked = blocked.filter((r) => !prevSet.has(r));
  const recovered = prevBlocked.filter((r) => !currSet.has(r));

  if (newlyBlocked.length > 0) {
    const detail = probed
      .filter((p) => newlyBlocked.includes(p.rail))
      .map((p) => `${p.rail}:${p.code ?? "?"}`)
      .join(" ");
    await sendOpsAlert({
      title: "Payment provider status API went UNREACHABLE mid-operation",
      severity: "critical",
      details: {
        blockedRails: newlyBlocked.join(", "),
        detail,
        impact: "Reconciliation cannot settle/refund pending payments on these rails until connectivity returns",
        hint: "Check the provider's status endpoint / IP whitelist / API credentials",
      },
    });
    log.error({ action: "recon.connectivity_lost", rails: newlyBlocked }, "recon connectivity lost");
  }

  if (recovered.length > 0) {
    await sendOpsAlert({
      title: "Payment provider status API connectivity RESTORED",
      severity: "warning",
      details: {
        restoredRails: recovered.join(", "),
        note: "Reconciliation will resume settling pending payments on the next sweep",
      },
    });
    log.info({ action: "recon.connectivity_restored", rails: recovered }, "recon connectivity restored");
  }

  return { ranAt, probed, blocked, newlyBlocked, recovered };
}
