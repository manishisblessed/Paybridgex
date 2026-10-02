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
import { deriveTxnRefs } from "@/lib/recon/refs";
import { recoverRefsFromApiLog } from "@/lib/recon/recover";
import { logger } from "@/lib/logger";

const log = logger.child({ module: "recon/rechargekit" });

/** Every RechargeKit (CC-2) transaction carries this partner tag. */
const RK_PARTNER = "SAMEDAY_RECHARGEKIT";

const DRAIN_AGE_MS = 2 * 60_000; // don't poll a txn younger than 2 min
const STUCK_THRESHOLD_MS = 60 * 60_000; // escalate after 1 hour

/**
 * Recover provider reference ids carried by a stored pay `response` JSON.
 *
 * When pay returns PENDING we persist `partnerTxnId = txn_id || request_id`, but
 * if BOTH were empty in the provider's response the row is left with a blank
 * `partnerTxnId` and becomes UNPOLLABLE — stuck in PROCESSING forever. The raw
 * pay response still carries `txn_id` / `request_id`, so we mine it here as a
 * fallback so those rows can finally be resolved.
 */
export function refsFromResponse(response: unknown): string[] {
  if (!response || typeof response !== "object") return [];
  const r = response as Record<string, unknown>;
  const out: string[] = [];
  for (const k of ["txn_id", "txnId", "request_id", "requestId"]) {
    const v = r[k];
    if (typeof v === "string" && v.trim().length > 0) out.push(v.trim());
  }
  return out;
}

/**
 * Column set for RechargeKit finalizers — adds `request` + `response` so
 * `deriveTxnRefs` can recover a poll reference even when `partnerTxnId` was
 * never persisted (pay process died before writing the partner result).
 */
const RK_TXN_SELECT = { ...FINALIZABLE_TXN_SELECT, request: true, response: true };

/**
 * Poll the RechargeKit status API for one transaction and finalize it.
 *
 * The stored `partnerTxnId` is `txn_id || request_id` from the pay response, so
 * we try it as a txn id first and fall back to a request id — either resolves
 * the same payment at the provider. We additionally try any `extraRefs` (webhook
 * ids, or ids recovered from the stored pay response) so a row whose
 * `partnerTxnId` came back EMPTY is still resolvable. PENDING leaves the row
 * untouched for the next trigger. Returns whether a terminal state was reached.
 */
async function pollAndFinalize(
  txn: FinalizableTxn,
  source: string,
  extraRefs: string[] = []
): Promise<{ outcome: "settled" | "refunded" | "pending" | "noop" }> {
  // Candidate provider references, de-duped, in priority order.
  const refs = Array.from(
    new Set(
      [txn.partnerTxnId ?? "", ...extraRefs]
        .map((s) => (typeof s === "string" ? s.trim() : ""))
        .filter((s) => s.length > 0)
    )
  );
  if (refs.length === 0) {
    log.warn({ refId: txn.refId }, "RechargeKit txn has no provider ref to poll");
    return { outcome: "noop" };
  }

  let r: Awaited<ReturnType<typeof rechargekitStatus>> | null = null;
  for (const ref of refs) {
    r = await rechargekitStatus({ txnId: ref });
    if (!r.ok) r = await rechargekitStatus({ requestId: ref });
    if (r.ok) break;
  }
  if (!r || !r.ok) {
    log.warn(
      { refId: txn.refId, code: r?.ok === false ? r.code : undefined },
      "RechargeKit status poll failed"
    );
    return { outcome: "noop" }; // transient — try again next trigger
  }

  const providerStatus = r.data.status;
  if (providerStatus === "PENDING") return { outcome: "pending" };

  const res = await finalizeServiceTransaction({
    txn,
    status: providerStatus, // SUCCESS | FAILED | REFUNDED
    partnerTxnId: r.data.txnId || refs[0],
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
  refs: string[],
  source = "webhook"
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
    select: RK_TXN_SELECT,
  });
  if (!row) return { matched: false };

  // Already terminal → nothing to do (still a match, so the dispatcher acks).
  // NEEDS_REVIEW is NON-terminal (held), so it stays resolvable here.
  if (row.status !== "INITIATED" && row.status !== "PROCESSING" && row.status !== "NEEDS_REVIEW") {
    return { matched: true, outcome: "noop", refId: row.refId };
  }

  const { request, response, ...txn } = row;
  // The webhook's own ids + any ids recovered from the stored pay request/
  // response are authoritative poll candidates alongside partnerTxnId.
  const { outcome } = await pollAndFinalize(txn, source, [
    ...cleaned,
    ...deriveTxnRefs({ partnerTxnId: txn.partnerTxnId, request, response }),
  ]);
  return { matched: true, outcome, refId: row.refId };
}

export type RechargekitReconSummary = {
  ranAt: string;
  drained: number;
  settled: number;
  refunded: number;
  pending: number;
  stuck: number;
  heldEscalated: number;
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
    ranAt, drained: 0, settled: 0, refunded: 0, pending: 0, stuck: 0, heldEscalated: 0, skipped: true,
  };

  if (!flags.rechargekit || !rechargekitConfigured()) {
    log.info({ action: "recon.rechargekit_skipped" }, "RechargeKit rail disabled/unconfigured");
    return empty;
  }

  const now = Date.now();
  // NOTE: we intentionally do NOT filter on `partnerTxnId: { not: null }` here.
  // A pay that returned PENDING with an empty txn_id/request_id leaves the row
  // with a blank partnerTxnId; excluding those made them permanently unpollable
  // (stuck in PROCESSING forever). pollAndFinalize now recovers a poll ref from
  // the stored pay `response`, so such rows can finally be settled/refunded.
  const inflight = await prisma.transaction.findMany({
    where: {
      // PROCESSING (pending at pay) + NEEDS_REVIEW (indeterminate, held) are both
      // non-terminal and must be polled for resolution.
      status: { in: ["PROCESSING", "NEEDS_REVIEW"] },
      partner: RK_PARTNER,
      createdAt: { lt: new Date(now - DRAIN_AGE_MS) },
    },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: RK_TXN_SELECT,
  });

  let drained = 0;
  let settled = 0;
  let refunded = 0;
  let pending = 0;
  for (const row of inflight) {
    try {
      const { request, response, ...txn } = row;
      let { outcome } = await pollAndFinalize(
        txn,
        "recon",
        deriveTxnRefs({ partnerTxnId: txn.partnerTxnId, request, response })
      );
      // Crash-proof fallback: RechargeKit has NO client-side correlation key,
      // so if the pay response was lost mid-crash the row is otherwise
      // unpollable. Recover the provider ref (txn_id/request_id) from the
      // durable PartnerApiLog and retry — auto-heals without a panel lookup.
      if (outcome === "noop") {
        const recovered = await recoverRefsFromApiLog(txn.refId);
        if (recovered.length) ({ outcome } = await pollAndFinalize(txn, "recon", recovered));
      }
      if (outcome === "settled") settled++;
      else if (outcome === "refunded") refunded++;
      else if (outcome === "pending") {
        pending++;
        continue;
      }
      drained++;
    } catch (err) {
      log.warn({ action: "recon.rechargekit_poll_failed", txnId: row.id, err: String(err) });
    }
  }

  // Escalate anything still non-terminal beyond the stuck threshold.
  const stuckRows = await prisma.transaction.findMany({
    where: {
      status: { in: ["PROCESSING", "NEEDS_REVIEW"] },
      partner: RK_PARTNER,
      createdAt: { lt: new Date(now - STUCK_THRESHOLD_MS) },
    },
    select: { id: true, refId: true, amount: true, createdAt: true, status: true, userId: true },
    orderBy: { createdAt: "asc" },
  });

  // Plain PROCESSING rows → ordinary warning (amount + age let ops locate the
  // txn in the RechargeKit panel; no mobile/card — no PII in alerts).
  const processingStuck = stuckRows.filter((r) => r.status === "PROCESSING");
  if (processingStuck.length > 0) {
    await sendOpsAlert({
      title: "RechargeKit payments stuck in PROCESSING",
      severity: "warning",
      details: {
        count: processingStuck.length,
        oldest: processingStuck[0].createdAt.toISOString(),
        stuck: processingStuck
          .slice(0, 10)
          .map((r) => `${r.refId} Rs.${r.amount.toNumber()} age=${Math.floor((now - r.createdAt.getTime()) / 60_000)}m`)
          .join(" ; "),
      },
    });
  }

  // NEEDS_REVIEW rows: INDETERMINATE pay response — provider may have charged
  // while the reserve is HELD. RechargeKit has NO client-side correlation key,
  // so a lost pay response is unrecoverable by status poll; escalate ONCE
  // (deduped via an audit marker) with a queryable review-queue trail.
  let heldEscalated = 0;
  const heldStuck = stuckRows.filter((r) => r.status === "NEEDS_REVIEW");
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
        meta: { refId: r.refId, amount: r.amount.toNumber(), reason: "indeterminate_unresolvable_by_status_api", ranAt },
      },
    });
    freshlyEscalated.push(r);
    heldEscalated++;
  }
  if (freshlyEscalated.length > 0) {
    await sendOpsAlert({
      title: "RechargeKit payments HELD for review — funds NOT refunded (possible provider charge)",
      severity: "critical",
      details: {
        count: freshlyEscalated.length,
        exposure: freshlyEscalated.reduce((s, r) => s + r.amount.toNumber(), 0),
        oldest: freshlyEscalated[0].createdAt.toISOString(),
        held: freshlyEscalated
          .slice(0, 10)
          .map((r) => `${r.refId} Rs.${r.amount.toNumber()} age=${Math.floor((now - r.createdAt.getTime()) / 60_000)}m`)
          .join(" ; "),
      },
    });
  }

  const summary: RechargekitReconSummary = {
    ranAt, drained, settled, refunded, pending, stuck: stuckRows.length, heldEscalated, skipped: false,
  };
  await prisma.auditLog.create({
    data: { action: "recon.rechargekit_recon", entity: "System", meta: { ...summary } },
  });
  return summary;
}
