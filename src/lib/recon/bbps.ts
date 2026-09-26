import { type ServiceCode } from "@prisma/client";
import { prisma } from "@/lib/db";
import { flags } from "@/lib/env";
import { getPartner } from "@/lib/partners";
import {
  finalizeServiceTransaction,
  FINALIZABLE_TXN_SELECT,
} from "@/lib/services/finalize";
import { sendOpsAlert } from "@/lib/monitoring/alerts";
import { deriveTxnRefs } from "@/lib/recon/refs";
import { recoverRefsFromApiLog } from "@/lib/recon/recover";
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
  //
  // We DELIBERATELY do NOT filter on `partnerTxnId: { not: null }`. A pay that
  // died between the fund reserve and writing the partner result leaves the row
  // with a BLANK partnerTxnId — but the pollable provider reference (Pay2New's
  // `bill_fetch_ref`) survives in the stored `request` JSON. `deriveTxnRefs`
  // recovers it, so such a row is reconciled instead of stranded in PROCESSING
  // forever (the exact gap that stalled real credit-card payments). Rows with
  // truly no recoverable reference are skipped (nothing to poll) and left for
  // the STUCK escalation below.
  const inflight = await prisma.transaction.findMany({
    where: {
      status: "PROCESSING",
      service: { in: BBPS_SERVICES },
      partner: { not: RK_PARTNER },
      createdAt: { lt: new Date(now - DRAIN_AGE_MS) },
    },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: { ...FINALIZABLE_TXN_SELECT, request: true, response: true },
  });

  // Poll a list of candidate references (order_id first, then request_id) until
  // the provider resolves one. The FIRST non-transient (ok) answer wins.
  type Resolved = { status: "SUCCESS" | "PENDING" | "FAILED" | "REFUNDED"; ref: string; raw: unknown };
  const tryResolve = async (refs: string[]): Promise<Resolved | null> => {
    for (const ref of refs) {
      let r = await bbps.status!({ orderId: ref });
      if (!r.ok) r = await bbps.status!({ requestId: ref });
      if (!r.ok) continue; // transient/unknown for this ref — try the next
      return { status: r.data.status, ref, raw: r.raw };
    }
    return null;
  };

  let drained = 0;
  for (const row of inflight) {
    try {
      const { request, response, ...txn } = row;
      const baseRefs = deriveTxnRefs({ partnerTxnId: txn.partnerTxnId, request, response });
      let resolved = baseRefs.length ? await tryResolve(baseRefs) : null;

      // Crash-proof fallback: if nothing on the row itself resolves, recover the
      // provider poll key from PartnerApiLog. This heals a row whose pay call
      // response (and thus request_id/order_id) was lost when the process died
      // mid-flight — no manual panel lookup needed. Only queried when the cheap
      // in-row refs fail, so it adds no per-row DB cost in the common case.
      if (!resolved) {
        const recovered = (await recoverRefsFromApiLog(txn.refId)).filter((r) => !baseRefs.includes(r));
        if (recovered.length) resolved = await tryResolve(recovered);
      }

      if (!resolved) continue; // nothing pollable yet — STUCK stage escalates

      if (resolved.status === "PENDING") {
        // Pending stays pending until the provider returns a terminal state.
        drained++;
        continue;
      }

      // SUCCESS/FAILED/REFUNDED all go through the SINGLE shared finalizer so a
      // BBPS bill payment settles exactly like the pay path: SUCCESS books the
      // company margin ((fee − GST) − vendorCharge) into the Revenue Wallet, and
      // FAILED/REFUNDED reverses the held reserve. Idempotent via the status
      // claim + keyed ledger, so a SUCCESS row can never be refunded and a
      // FAILED reserve is refunded at most once, no matter how often this runs.
      const res = await finalizeServiceTransaction({
        txn,
        status: resolved.status, // SUCCESS | FAILED | REFUNDED
        // Stamp the resolving reference so a row that had a blank partnerTxnId
        // is now traceable to the provider record.
        partnerTxnId: txn.partnerTxnId ?? resolved.ref,
        errorCode: resolved.status === "SUCCESS" ? null : "BBPS_PROVIDER_FAILED",
        errorMessage:
          resolved.status === "SUCCESS"
            ? null
            : `Bill payment ${resolved.status.toLowerCase()} by provider`,
        raw: resolved.raw,
        source: "recon",
      });
      if (res.outcome === "settled") settled++;
      else if (res.outcome === "refunded") refunded++;
      drained++;
    } catch (err) {
      logger.warn({ action: "recon.bbps_poll_failed", txnId: row.id, err: String(err) });
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
    orderBy: { createdAt: "asc" },
    select: { id: true, refId: true, amount: true, createdAt: true, request: true },
  });

  if (stillStuck.length > 0) {
    // Enrich the alert so ops can resolve WITHOUT any diagnostics: the
    // bill_fetch_ref is an opaque provider token (NOT PII) that pinpoints the
    // txn in the Same Day panel to read its terminal status + request_id.
    // Amount + age help cross-reference; no mobile/card is included.
    const items = stillStuck
      .slice(0, 10)
      .map((r) => {
        const billFetchRef = deriveTxnRefs({ request: r.request }).find(Boolean) ?? "—";
        const ageMin = Math.floor((now - r.createdAt.getTime()) / 60_000);
        return `${r.refId} Rs.${r.amount.toNumber()} age=${ageMin}m billFetchRef=${billFetchRef}`;
      })
      .join(" ; ");
    await sendOpsAlert({
      title: "BBPS transactions stuck in PROCESSING",
      severity: "warning",
      details: {
        count: stillStuck.length,
        oldest: stillStuck[0].createdAt.toISOString(),
        // Look up billFetchRef in the Same Day panel → read terminal status +
        // request_id, then the recon recovery/one-off resolver finalizes it.
        stuck: items,
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
