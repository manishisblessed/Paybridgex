import { prisma } from "@/lib/db";
import { flags } from "@/lib/env";
import { getPartner } from "@/lib/partners";
import { reconcilePayout } from "@/lib/payout/service";
import { sendOpsAlert } from "@/lib/monitoring/alerts";
import { logger } from "@/lib/logger";

/**
 * Daily payout reconciliation — the deep sweep that runs beyond the 5-minute
 * stuck-PROCESSING poller:
 *
 *   1. DRAIN     — every non-terminal payout older than 10 minutes is polled
 *                  and finalized via the shared idempotent state machine.
 *   2. STUCK     — anything still non-terminal after 2 hours is escalated to
 *                  the ops webhook (held user funds that are not settling).
 *   3. VERIFY    — recent terminal rows (last 48h) are re-checked against the
 *                  provider's books. A disagreement (we say SUCCESS, provider
 *                  says FAILED — or vice versa) means our ledger and the
 *                  vendor's money do not match: critical, human review.
 *
 * Verification never auto-flips a settled state — reconciliation of a
 * disagreement is a deliberate operator action. Findings land in AuditLog
 * (action recon.payout_mismatch) and the ops webhook.
 */

export type PayoutReconSummary = {
  ranAt: string;
  drained: number;
  stuck: number;
  verified: number;
  mismatches: number;
  skipped: boolean;
};

const STUCK_THRESHOLD_MS = 2 * 3_600_000;

export async function runDailyPayoutReconciliation(): Promise<PayoutReconSummary> {
  const ranAt = new Date().toISOString();

  if (!flags.payout) {
    logger.info({ action: "recon.payout_skipped", reason: "payout partner disabled" });
    return { ranAt, drained: 0, stuck: 0, verified: 0, mismatches: 0, skipped: true };
  }

  const now = Date.now();

  // ── 1. Drain: poll every non-terminal payout older than 10 minutes. ──────
  const inflight = await prisma.payoutRequest.findMany({
    where: {
      status: { in: ["APPROVED", "PROCESSING"] },
      createdAt: { lt: new Date(now - 10 * 60_000) },
    },
    orderBy: { createdAt: "asc" },
    take: 500,
    select: { id: true, createdAt: true },
  });

  let drained = 0;
  for (const row of inflight) {
    try {
      await reconcilePayout(row.id);
      drained++;
    } catch (err) {
      logger.warn({ action: "recon.payout_poll_failed", payoutId: row.id, err: String(err) });
    }
  }

  // ── 2. Stuck: escalate anything still holding funds after 2 hours. ───────
  const stillStuck = await prisma.payoutRequest.findMany({
    where: {
      status: { in: ["APPROVED", "PROCESSING"] },
      createdAt: { lt: new Date(now - STUCK_THRESHOLD_MS) },
    },
    select: { id: true, status: true, createdAt: true },
  });

  if (stillStuck.length > 0) {
    await sendOpsAlert({
      title: "Payouts stuck in a non-terminal state",
      severity: "warning",
      details: {
        count: stillStuck.length,
        oldest: stillStuck[0].createdAt.toISOString(),
        ids: stillStuck.slice(0, 10).map((r) => r.id).join(", "),
      },
    });
  }

  // ── 3. Verify: re-check recent terminal rows against the provider. ───────
  const provider = getPartner("payout");
  const recentTerminal = await prisma.payoutRequest.findMany({
    where: {
      status: { in: ["SUCCESS", "FAILED"] },
      completedAt: { gte: new Date(now - 48 * 3_600_000) },
      providerTxnId: { not: null },
    },
    orderBy: { completedAt: "desc" },
    take: 500,
    select: { id: true, status: true, providerTxnId: true, providerReferenceId: true, userId: true },
  });

  let verified = 0;
  let mismatches = 0;
  for (const row of recentTerminal) {
    let providerStatus: "PROCESSING" | "PAID" | "FAILED" | null = null;
    try {
      const res = await provider.status(row.providerTxnId || row.providerReferenceId);
      if (!res.ok) continue; // transient; next run will retry
      providerStatus = res.data.status;
    } catch (err) {
      logger.warn({ action: "recon.payout_verify_failed", payoutId: row.id, err: String(err) });
      continue;
    }
    verified++;

    const agree =
      (row.status === "SUCCESS" && providerStatus === "PAID") ||
      (row.status === "FAILED" && providerStatus === "FAILED") ||
      providerStatus === "PROCESSING"; // provider view may briefly lag

    if (!agree) {
      mismatches++;
      await prisma.auditLog.create({
        data: {
          userId: row.userId,
          action: "recon.payout_mismatch",
          entity: "PayoutRequest",
          entityId: row.id,
          meta: { ourStatus: row.status, providerStatus, ranAt },
        },
      });
    }
  }

  if (mismatches > 0) {
    await sendOpsAlert({
      title: "Payout ledger disagrees with provider",
      severity: "critical",
      details: { verified, mismatches },
    });
  }

  const summary: PayoutReconSummary = {
    ranAt,
    drained,
    stuck: stillStuck.length,
    verified,
    mismatches,
    skipped: false,
  };

  await prisma.auditLog.create({
    data: {
      action: "recon.payout_recon",
      entity: "System",
      meta: { ...summary },
    },
  });

  return summary;
}
