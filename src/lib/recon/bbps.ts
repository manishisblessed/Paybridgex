import { Prisma, type ServiceCode } from "@prisma/client";
import { prisma } from "@/lib/db";
import { flags } from "@/lib/env";
import { getPartner } from "@/lib/partners";
import { creditWallet } from "@/lib/ledger";
import { round, add } from "@/lib/money";
import { sendOpsAlert } from "@/lib/monitoring/alerts";
import { emitWebhookEvent } from "@/lib/platform/webhooks";
import { logger } from "@/lib/logger";

const BBPS_SERVICES: ServiceCode[] = [
  "BILL_ELECTRICITY", "BILL_WATER", "BILL_GAS",
  "BILL_CREDIT_CARD", "BILL_EDUCATION", "BILL_INSURANCE",
  "RECHARGE_BROADBAND",
];

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
      partnerTxnId: { not: null },
      createdAt: { lt: new Date(now - DRAIN_AGE_MS) },
    },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: {
      id: true,
      refId: true,
      userId: true,
      partnerTxnId: true,
      amount: true,
      fee: true,
      commission: true,
      service: true,
      partner: true,
      createdAt: true,
    },
  });

  let drained = 0;
  for (const txn of inflight) {
    try {
      const r = await bbps.status({ orderId: txn.partnerTxnId! });
      if (!r.ok) continue;

      if (r.data.status === "PENDING") {
        drained++;
        continue;
      }

      if (r.data.status === "SUCCESS") {
        await prisma.$transaction(async (tx) => {
          await tx.transaction.update({
            where: { id: txn.id },
            data: {
              status: "SUCCESS",
              partnerTxnId: txn.partnerTxnId,
              response: { reconSettled: true, providerStatus: r.data.status, operatorRef: r.data.operatorRef } as Prisma.InputJsonValue,
            },
          });
          // BBPS does not earn commission (only PG/POS/QR do).
          await tx.auditLog.create({
            data: {
              userId: txn.userId,
              action: "recon.bbps_settled",
              entity: "Transaction",
              entityId: txn.id,
              meta: { refId: txn.refId, providerStatus: r.data.status },
            },
          });
        });
        void emitWebhookEvent(txn.userId, "txn.success", {
          refId: txn.refId,
          service: txn.service,
          amount: txn.amount.toNumber(),
        });
        settled++;
      } else {
        // FAILED or REFUNDED — reverse the held funds.
        const reserveAmount = round(add(txn.amount.toNumber(), txn.fee.toNumber()));
        await prisma.$transaction(async (tx) => {
          await tx.transaction.update({
            where: { id: txn.id },
            data: {
              status: r.data.status === "REFUNDED" ? "REFUNDED" : "FAILED",
              errorCode: "BBPS_PROVIDER_FAILED",
              errorMessage: `Provider reported ${r.data.status} during reconciliation`,
              response: { reconSettled: true, providerStatus: r.data.status } as Prisma.InputJsonValue,
            },
          });
          await creditWallet({
            userId: txn.userId,
            amount: reserveAmount,
            reason: "REVERSAL",
            refType: "Transaction",
            refId: txn.id,
            idempotencyKey: `txn:${txn.userId}:${txn.refId}:reversal:recon`,
          }, tx);
          await tx.auditLog.create({
            data: {
              userId: txn.userId,
              action: "recon.bbps_refunded",
              entity: "Transaction",
              entityId: txn.id,
              meta: { refId: txn.refId, providerStatus: r.data.status },
            },
          });
        });
        void emitWebhookEvent(txn.userId, "txn.failed", {
          refId: txn.refId,
          service: txn.service,
          amount: txn.amount.toNumber(),
          code: "BBPS_PROVIDER_FAILED",
          message: `Bill payment ${r.data.status.toLowerCase()} by provider`,
        });
        refunded++;
      }
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
