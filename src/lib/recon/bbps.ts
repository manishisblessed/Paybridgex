import { type ServiceCode } from "@prisma/client";
import { prisma } from "@/lib/db";
import { flags } from "@/lib/env";
import { getPartner } from "@/lib/partners";
import {
  finalizeServiceTransaction,
  FINALIZABLE_TXN_SELECT,
} from "@/lib/services/finalize";
import { sendOpsAlert } from "@/lib/monitoring/alerts";
import { logger } from "@/lib/logger";

const BBPS_SERVICES: ServiceCode[] = [
  "BILL_ELECTRICITY", "BILL_WATER", "BILL_GAS",
  "BILL_CREDIT_CARD", "BILL_EDUCATION", "BILL_INSURANCE",
  "RECHARGE_BROADBAND",
];

// The Same Day RechargeKit CC-2 rail also books BILL_CREDIT_CARD transactions,
// but it is a DIFFERENT partner/API (polled + finalised by recon/rechargekit.ts
// and the /api/webhooks/sameday receiver). Never let the BBPS/Pay2New status
// endpoint be asked about a RechargeKit txn — exclude it from every query here.
const RK_PARTNER = "SAMEDAY_RECHARGEKIT";

/**
 * BBPS reconciliation — polls PROCESSING BBPS transactions and settles them.
 *
 * The BBPS rail does not push status updates. This sweep is our only safety
 * net for transactions that returned PENDING at pay-time or whose response was
 * ambiguous.
 *
 * Three stages (mirrors the payout recon pattern):
 *   1. DRAIN   — poll every PROCESSING BBPS txn older than 2 minutes
 *   2. STUCK   — escalate anything still PROCESSING after 1 hour
 *   3. VERIFY  — re-check recent SUCCESS/FAILED rows (last 24h) for mismatches
 */

export type BbpsReconSummary = {
  ranAt: string;
  drained: number;
  settled: number;
  refunded: number;
  stuck: number;
  verified: number;
  mismatches: number;
  skipped: boolean;
};

const DRAIN_AGE_MS = 2 * 60_000;
const STUCK_THRESHOLD_MS = 60 * 60_000;
const VERIFY_WINDOW_MS = 24 * 3_600_000;

export async function runBbpsReconciliation(): Promise<BbpsReconSummary> {
  const ranAt = new Date().toISOString();

  if (!flags.bbps) {
    logger.info({ action: "recon.bbps_skipped", reason: "bbps partner disabled" });
    return { ranAt, drained: 0, settled: 0, refunded: 0, stuck: 0, verified: 0, mismatches: 0, skipped: true };
  }

  const bbps = getPartner("bbps");
  if (!bbps.status) {
    logger.info({ action: "recon.bbps_skipped", reason: "provider has no status method" });
    return { ranAt, drained: 0, settled: 0, refunded: 0, stuck: 0, verified: 0, mismatches: 0, skipped: true };
  }

  const now = Date.now();
  let settled = 0;
  let refunded = 0;

  // 1. DRAIN — poll every PROCESSING BBPS transaction older than 2 minutes.
  const inflight = await prisma.transaction.findMany({
    where: {
      status: "PROCESSING",
      service: { in: BBPS_SERVICES },
      partner: { not: RK_PARTNER },
      partnerTxnId: { not: null },
      createdAt: { lt: new Date(now - DRAIN_AGE_MS) },
    },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: FINALIZABLE_TXN_SELECT,
  });

  let drained = 0;
  for (const txn of inflight) {
    try {
      const r = await bbps.status!({ orderId: txn.partnerTxnId! });
      if (!r.ok) continue;

      if (r.data.status === "PENDING") {
        drained++;
        continue;
      }

      // SUCCESS/FAILED/REFUNDED all go through the SINGLE shared finalizer so a
      // BBPS bill payment settles exactly like the pay path: SUCCESS books the
      // company margin ((fee − GST) − vendorCharge) into the Revenue Wallet, and
      // FAILED/REFUNDED reverses the held reserve. Idempotent via the status
      // claim + keyed ledger, so racing the webhook is a safe no-op. (The old
      // inline path skipped the margin credit — a silent revenue leak.)
      const res = await finalizeServiceTransaction({
        txn,
        status: r.data.status, // SUCCESS | FAILED | REFUNDED
        partnerTxnId: txn.partnerTxnId,
        errorCode: r.data.status === "SUCCESS" ? null : "BBPS_PROVIDER_FAILED",
        errorMessage:
          r.data.status === "SUCCESS"
            ? null
            : `Bill payment ${r.data.status.toLowerCase()} by provider`,
        raw: r.raw,
        source: "recon",
      });
      if (res.outcome === "settled") settled++;
      else if (res.outcome === "refunded") refunded++;
      drained++;
    } catch (err) {
      logger.warn({ action: "recon.bbps_poll_failed", txnId: txn.id, err: String(err) });
    }
  }

  // 2. STUCK — escalate anything still PROCESSING after 1 hour.
  const stillStuck = await prisma.transaction.findMany({
    where: {
      status: "PROCESSING",
      service: { in: BBPS_SERVICES },
      partner: { not: RK_PARTNER },
      createdAt: { lt: new Date(now - STUCK_THRESHOLD_MS) },
    },
    select: { id: true, refId: true, createdAt: true },
  });

  if (stillStuck.length > 0) {
    await sendOpsAlert({
      title: "BBPS transactions stuck in PROCESSING",
      severity: "warning",
      details: {
        count: stillStuck.length,
        oldest: stillStuck[0].createdAt.toISOString(),
        refIds: stillStuck.slice(0, 10).map((r) => r.refId).join(", "),
      },
    });
  }

  // 3. VERIFY — re-check recent terminal BBPS rows against the provider.
  let verified = 0;
  let mismatches = 0;
  const recentTerminal = await prisma.transaction.findMany({
    where: {
      status: { in: ["SUCCESS", "FAILED"] },
      service: { in: BBPS_SERVICES },
      partner: { not: RK_PARTNER },
      partnerTxnId: { not: null },
      updatedAt: { gte: new Date(now - VERIFY_WINDOW_MS) },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: { id: true, refId: true, status: true, partnerTxnId: true, userId: true },
  });

  for (const row of recentTerminal) {
    try {
      const r = await bbps.status({ orderId: row.partnerTxnId! });
      if (!r.ok) continue;
      verified++;

      const provStatus = r.data.status;
      const agree =
        (row.status === "SUCCESS" && provStatus === "SUCCESS") ||
        (row.status === "FAILED" && (provStatus === "FAILED" || provStatus === "REFUNDED")) ||
        provStatus === "PENDING";

      if (!agree) {
        mismatches++;
        await prisma.auditLog.create({
          data: {
            userId: row.userId,
            action: "recon.bbps_mismatch",
            entity: "Transaction",
            entityId: row.id,
            meta: { refId: row.refId, ourStatus: row.status, providerStatus: provStatus, ranAt },
          },
        });
      }
    } catch (err) {
      logger.warn({ action: "recon.bbps_verify_failed", txnId: row.id, err: String(err) });
    }
  }

  if (mismatches > 0) {
    await sendOpsAlert({
      title: "BBPS ledger disagrees with provider",
      severity: "critical",
      details: { verified, mismatches },
    });
  }

  const summary: BbpsReconSummary = { ranAt, drained, settled, refunded, stuck: stillStuck.length, verified, mismatches, skipped: false };
  await prisma.auditLog.create({
    data: { action: "recon.bbps_recon", entity: "System", meta: { ...summary } },
  });

  return summary;
}
