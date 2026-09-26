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

/**
 * Probe every enabled money rail's status API and alert (critical) if any is
 * unreachable/blocked. Never throws — a preflight hiccup must not stop the
 * worker from booting (the sweeps still run; they just log poll failures).
 */
export async function runReconPreflight(): Promise<ReconPreflightResult> {
  const ranAt = new Date().toISOString();
  let probes: (RailProbe | null)[] = [];
  try {
    probes = await Promise.all([probeBbps(), probeRechargekit(), probePayout()]);
  } catch (e) {
    log.warn({ err: String(e) }, "recon preflight probe batch failed");
  }
  const probed = probes.filter((p): p is RailProbe => p !== null);
  const blocked = probed.filter((p) => p.blocked).map((p) => p.rail);

  for (const p of probed) {
    log.info({ action: "recon.preflight_probe", ...p }, `preflight ${p.rail}: ${p.blocked ? "BLOCKED" : "ok"}`);
  }

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
