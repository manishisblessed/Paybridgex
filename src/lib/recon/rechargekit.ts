import { prisma } from "@/lib/db";
import { flags } from "@/lib/env";
import {
  rechargekitConfigured,
  rechargekitStatus,
} from "@/lib/partners/sameday-rechargekit";
import {
  finalizeServiceTransaction,
  FINALIZABLE_TXN_SELECT,
  type FinalizableTxn,
} from "@/lib/services/finalize";
import { sendOpsAlert } from "@/lib/monitoring/alerts";
import { logger } from "@/lib/logger";

const log = logger.child({ module: "recon/rechargekit" });

/** Every RechargeKit (CC-2) transaction carries this partner tag. */
const RK_PARTNER = "SAMEDAY_RECHARGEKIT";

const DRAIN_AGE_MS = 2 * 60_000; // don't poll a txn younger than 2 min
const STUCK_THRESHOLD_MS = 60 * 60_000; // escalate after 1 hour

/**
 * Poll the RechargeKit status API for one transaction and finalize it.
 *
 * The stored `partnerTxnId` is `txn_id || request_id` from the pay response, so
 * we try it as a txn id first and fall back to a request id — either resolves
 * the same payment at the provider. PENDING leaves the row untouched for the
 * next trigger. Returns whether a terminal state was reached.
 */
async function pollAndFinalize(
  txn: FinalizableTxn,
  source: string
): Promise<{ outcome: "settled" | "refunded" | "pending" | "noop" }> {
  const ref = txn.partnerTxnId ?? undefined;
  if (!ref) {
    log.warn({ refId: txn.refId }, "RechargeKit txn has no provider ref to poll");
    return { outcome: "noop" };
  }

  let r = await rechargekitStatus({ txnId: ref });
  if (!r.ok) r = await rechargekitStatus({ requestId: ref });
  if (!r.ok) {
    log.warn({ refId: txn.refId, code: r.code }, "RechargeKit status poll failed");
    return { outcome: "noop" }; // transient — try again next trigger
  }

  const providerStatus = r.data.status;
  if (providerStatus === "PENDING") return { outcome: "pending" };

  const res = await finalizeServiceTransaction({
    txn,
    status: providerStatus, // SUCCESS | FAILED | REFUNDED
    partnerTxnId: r.data.txnId || ref,
    raw: r.raw,
    source,
  });
  return { outcome: res.outcome === "noop" ? "noop" : res.outcome };
}

/**
 * Webhook correlation entry: given the reference ids carried by an inbound Same
 * Day webhook, find the matching RechargeKit transaction and finalize it by
 * RE-FETCHING the provider status (the webhook is only a trigger). Idempotent.
 */
export async function reconcileRechargekitFromWebhook(
  refs: string[]
): Promise<{ matched: boolean; outcome?: string; refId?: string }> {
  const cleaned = Array.from(
    new Set(refs.filter((r) => typeof r === "string" && r.length > 0))
  );
  if (cleaned.length === 0) return { matched: false };

  const row = await prisma.transaction.findFirst({
    where: {
      partner: RK_PARTNER,
      OR: [{ partnerTxnId: { in: cleaned } }, { refId: { in: cleaned } }],
    },
    select: FINALIZABLE_TXN_SELECT,
  });
  if (!row) return { matched: false };

  // Already terminal → nothing to do (still a match, so the dispatcher acks).
  if (row.status !== "INITIATED" && row.status !== "PROCESSING") {
    return { matched: true, outcome: "noop", refId: row.refId };
  }

  const { outcome } = await pollAndFinalize(row, "webhook");
  return { matched: true, outcome, refId: row.refId };
}

export type RechargekitReconSummary = {
  ranAt: string;
  drained: number;
  settled: number;
  refunded: number;
  pending: number;
  stuck: number;
  skipped: boolean;
};

/**
 * Safety-net sweep for RechargeKit CC-2 payments left PROCESSING.
 *
 * The inbound webhook is the primary finaliser; this sweep repairs anything a
 * missed/failed delivery left in flight. Mirrors the BBPS/payout recon pattern.
 * The webhook path and this sweep share `finalizeServiceTransaction`, so they
 * can race safely.
 */
export async function runRechargekitReconciliation(): Promise<RechargekitReconSummary> {
  const ranAt = new Date().toISOString();
  const empty: RechargekitReconSummary = {
    ranAt, drained: 0, settled: 0, refunded: 0, pending: 0, stuck: 0, skipped: true,
  };

  if (!flags.rechargekit || !rechargekitConfigured()) {
    log.info({ action: "recon.rechargekit_skipped" }, "RechargeKit rail disabled/unconfigured");
    return empty;
  }

  const now = Date.now();
  const inflight = await prisma.transaction.findMany({
    where: {
      status: "PROCESSING",
      partner: RK_PARTNER,
      partnerTxnId: { not: null },
      createdAt: { lt: new Date(now - DRAIN_AGE_MS) },
    },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: FINALIZABLE_TXN_SELECT,
  });

  let drained = 0;
  let settled = 0;
  let refunded = 0;
  let pending = 0;
  for (const txn of inflight) {
    try {
      const { outcome } = await pollAndFinalize(txn, "recon");
      if (outcome === "settled") settled++;
      else if (outcome === "refunded") refunded++;
      else if (outcome === "pending") {
        pending++;
        continue;
      }
      drained++;
    } catch (err) {
      log.warn({ action: "recon.rechargekit_poll_failed", txnId: txn.id, err: String(err) });
    }
  }

  // Escalate anything still PROCESSING beyond the stuck threshold.
  const stuckRows = await prisma.transaction.findMany({
    where: {
      status: "PROCESSING",
      partner: RK_PARTNER,
      createdAt: { lt: new Date(now - STUCK_THRESHOLD_MS) },
    },
    select: { refId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  if (stuckRows.length > 0) {
    await sendOpsAlert({
      title: "RechargeKit payments stuck in PROCESSING",
      severity: "warning",
      details: {
        count: stuckRows.length,
        oldest: stuckRows[0].createdAt.toISOString(),
        refIds: stuckRows.slice(0, 10).map((r) => r.refId).join(", "),
      },
    });
  }

  const summary: RechargekitReconSummary = {
    ranAt, drained, settled, refunded, pending, stuck: stuckRows.length, skipped: false,
  };
  await prisma.auditLog.create({
    data: { action: "recon.rechargekit_recon", entity: "System", meta: { ...summary } },
  });
  return summary;
}
