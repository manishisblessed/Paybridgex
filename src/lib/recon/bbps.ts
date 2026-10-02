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
  heldEscalated: number;
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
    return { ranAt, drained: 0, settled: 0, refunded: 0, stuck: 0, heldEscalated: 0, verified: 0, mismatches: 0, skipped: true };
  }

  const bbps = getPartner("bbps");
  if (!bbps.status) {
    logger.info({ action: "recon.bbps_skipped", reason: "provider has no status method" });
    return { ranAt, drained: 0, settled: 0, refunded: 0, stuck: 0, heldEscalated: 0, verified: 0, mismatches: 0, skipped: true };
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
      // PROCESSING (ambiguous/pending at pay) + NEEDS_REVIEW (indeterminate,
      // funds held) are both non-terminal and must be polled for resolution.
      status: { in: ["PROCESSING", "NEEDS_REVIEW"] },
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
  type Resolved = {
    status: "SUCCESS" | "PENDING" | "FAILED" | "REFUNDED";
    ref: string;
    /** Authoritative pay-step ref echoed by the provider (if any). */
    payRef: string | null;
    raw: unknown;
  };
  const tryResolve = async (refs: string[]): Promise<Resolved | null> => {
    for (const ref of refs) {
      // Try the ref as a pay order_id, then request_id, then — since the Oct-2026
      // provider release — the bill_fetch_ref we always retain. The last form is
      // what recovers a payment whose pay response was lost.
      let r = await bbps.status!({ orderId: ref });
      if (!r.ok) r = await bbps.status!({ requestId: ref });
      if (!r.ok) r = await bbps.status!({ billFetchRef: ref });
      if (!r.ok) continue; // transient/unknown for this ref — try the next
      return { status: r.data.status, ref, payRef: r.data.orderId ?? r.data.requestId ?? null, raw: r.raw };
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
        // Stamp the authoritative pay-step reference (falling back to whatever we
        // resolved with) so a row that had a blank partnerTxnId is now traceable.
        partnerTxnId: txn.partnerTxnId ?? resolved.payRef ?? resolved.ref,
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

  // 2. STUCK — escalate anything still non-terminal after 1 hour.
  const stillStuck = await prisma.transaction.findMany({
    where: {
      status: { in: ["PROCESSING", "NEEDS_REVIEW"] },
      service: { in: BBPS_SERVICES },
      partner: { not: RK_PARTNER },
      createdAt: { lt: new Date(now - STUCK_THRESHOLD_MS) },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, refId: true, amount: true, createdAt: true, request: true, status: true, userId: true },
  });

  const describe = (r: (typeof stillStuck)[number]): string => {
    const billFetchRef = deriveTxnRefs({ request: r.request }).find(Boolean) ?? "—";
    const ageMin = Math.floor((now - r.createdAt.getTime()) / 60_000);
    return `${r.refId} Rs.${r.amount.toNumber()} age=${ageMin}m billFetchRef=${billFetchRef}`;
  };

  // 2a. Plain PROCESSING rows (pending at pay, nothing held beyond the normal
  // reserve) → ordinary warning so ops can watch them clear.
  const processingStuck = stillStuck.filter((r) => r.status === "PROCESSING");
  if (processingStuck.length > 0) {
    await sendOpsAlert({
      title: "BBPS transactions stuck in PROCESSING",
      severity: "warning",
      details: {
        count: processingStuck.length,
        oldest: processingStuck[0].createdAt.toISOString(),
        // Look up billFetchRef in the Same Day panel → read terminal status +
        // request_id, then the recon recovery/one-off resolver finalizes it.
        stuck: processingStuck.slice(0, 10).map(describe).join(" ; "),
      },
    });
  }

  // 2b. NEEDS_REVIEW rows are the financial-exposure case: the pay response was
  // INDETERMINATE, so the provider may have CHARGED the customer while the
  // retailer's reserve is HELD (never refunded). The status API cannot resolve
  // these from the bill_fetch_ref (ORDER_NOT_FOUND — the pay-step ref was lost),
  // so they require a human/panel lookup + the admin resolver. We escalate each
  // row EXACTLY ONCE (deduped via an audit marker) to avoid re-alerting every
  // 5-minute sweep, and leave a queryable review-queue trail.
  let heldEscalated = 0;
  const heldStuck = stillStuck.filter((r) => r.status === "NEEDS_REVIEW");
  const freshlyEscalated: typeof heldStuck = [];
  for (const r of heldStuck) {
    const already = await prisma.auditLog.findFirst({
      where: { entityId: r.id, action: "recon.needs_review_escalated" },
      select: { id: true },
    });
    if (already) continue;
    await prisma.auditLog.create({
      data: {
        userId: r.userId,
        action: "recon.needs_review_escalated",
        entity: "Transaction",
        entityId: r.id,
        meta: {
          refId: r.refId,
          amount: r.amount.toNumber(),
          billFetchRef: deriveTxnRefs({ request: r.request }).find(Boolean) ?? null,
          reason: "indeterminate_unresolvable_by_status_api",
          ranAt,
        },
      },
    });
    freshlyEscalated.push(r);
    heldEscalated++;
  }
  if (freshlyEscalated.length > 0) {
    await sendOpsAlert({
      title: "BBPS payments HELD for review — funds NOT refunded (possible provider charge)",
      severity: "critical",
      details: {
        count: freshlyEscalated.length,
        exposure: freshlyEscalated.reduce((s, r) => s + r.amount.toNumber(), 0),
        oldest: freshlyEscalated[0].createdAt.toISOString(),
        // ACTION: look up each billFetchRef in the Same Day panel to read the
        // terminal status + pay-step request_id, then finalise via the admin
        // resolver (SUCCESS books margin; genuine FAILED refunds the reserve).
        held: freshlyEscalated.slice(0, 10).map(describe).join(" ; "),
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

  const summary: BbpsReconSummary = { ranAt, drained, settled, refunded, stuck: stillStuck.length, heldEscalated, verified, mismatches, skipped: false };
  await prisma.auditLog.create({
    data: { action: "recon.bbps_recon", entity: "System", meta: { ...summary } },
  });

  return summary;
}

/** The subset of BBPS services settled over the Pay2New rail. */
const BBPS_SERVICE_SET = new Set<ServiceCode>(BBPS_SERVICES);

/**
 * Webhook correlation for the Pay2New `pay2new.cc.status` event: given the refs
 * the webhook carries (bill_fetch_ref, pay order_id, request_id) find the
 * matching BBPS transaction and finalize it by RE-FETCHING the provider status
 * (the webhook is only a trigger — never the source of truth). Idempotent via the
 * shared finalizer, so it races safely with the recon sweep.
 *
 * Correlation is robust to the lost-pay-response case: such a row has a BLANK
 * partnerTxnId, but its `bill_fetch_ref` survives in the stored pay request, so we
 * match on that JSON path when the pay-step refs don't hit.
 */
export async function reconcileBbpsFromWebhook(
  refs: string[],
  billFetchRef?: string
): Promise<{ matched: boolean; outcome?: string; refId?: string }> {
  const cleaned = Array.from(new Set(refs.filter((r) => typeof r === "string" && r.length > 0)));
  const bfr = billFetchRef?.trim();
  if (cleaned.length === 0 && !bfr) return { matched: false };

  const bbps = getPartner("bbps");
  if (!bbps.status) return { matched: false };

  const row = await prisma.transaction.findFirst({
    where: {
      partner: { not: RK_PARTNER },
      service: { in: BBPS_SERVICES },
      OR: [
        ...(cleaned.length ? [{ partnerTxnId: { in: cleaned } }, { refId: { in: cleaned } }] : []),
        // The bill_fetch_ref lives in the stored pay request — the only key that
        // survives a lost pay response.
        ...(bfr
          ? [
              { request: { path: ["customerParams", "billFetchRef"], equals: bfr } },
              { request: { path: ["customerParams", "bill_fetch_ref"], equals: bfr } },
            ]
          : []),
      ],
    },
    select: { ...FINALIZABLE_TXN_SELECT, request: true, response: true },
  });
  if (!row || !BBPS_SERVICE_SET.has(row.service)) return { matched: false };

  // Already terminal → nothing to do (still a match, so the dispatcher acks).
  // NEEDS_REVIEW is NON-terminal (held), so it stays resolvable here.
  if (row.status !== "INITIATED" && row.status !== "PROCESSING" && row.status !== "NEEDS_REVIEW") {
    return { matched: true, outcome: "noop", refId: row.refId };
  }

  const { request, response, ...txn } = row;
  const candidates = Array.from(
    new Set(
      [
        ...cleaned,
        ...(bfr ? [bfr] : []),
        ...deriveTxnRefs({ partnerTxnId: txn.partnerTxnId, request, response }),
      ].filter(Boolean)
    )
  );

  // Re-poll the authoritative status (order_id → request_id → bill_fetch_ref).
  let resolvedStatus: "SUCCESS" | "PENDING" | "FAILED" | "REFUNDED" | null = null;
  let payRef: string | null = null;
  let raw: unknown = null;
  for (const ref of candidates) {
    let r = await bbps.status({ orderId: ref });
    if (!r.ok) r = await bbps.status({ requestId: ref });
    if (!r.ok) r = await bbps.status({ billFetchRef: ref });
    if (r.ok) {
      resolvedStatus = r.data.status;
      payRef = r.data.orderId ?? r.data.requestId ?? null;
      raw = r.raw;
      break;
    }
  }
  if (!resolvedStatus) return { matched: true, outcome: "noop", refId: txn.refId };
  if (resolvedStatus === "PENDING") return { matched: true, outcome: "pending", refId: txn.refId };

  const res = await finalizeServiceTransaction({
    txn,
    status: resolvedStatus,
    partnerTxnId: txn.partnerTxnId ?? payRef,
    errorCode: resolvedStatus === "SUCCESS" ? null : "BBPS_PROVIDER_FAILED",
    errorMessage: resolvedStatus === "SUCCESS" ? null : `Bill payment ${resolvedStatus.toLowerCase()} by provider`,
    raw,
    source: "webhook",
  });
  return { matched: true, outcome: res.outcome, refId: txn.refId };
}
