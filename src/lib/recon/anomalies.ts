/**
 * Transaction anomaly detection sweep.
 *
 * Runs every 5 minutes (worker queue `txn.anomaly.sweep`) and flags money-safety
 * anomalies that need admin attention on the Reversal Desk:
 *
 *   1. FAILED_NO_REVERSAL  — a FAILED / REFUNDED transaction whose wallet debit
 *      was never reversed. The retailer lost money.
 *   2. SUCCESS_NO_PROVIDER  — a SUCCESS transaction with no partnerTxnId on a
 *      rail that SHOULD have one (BBPS/RechargeKit). Likely an idempotent replay
 *      that slipped through before the fix, or a lost response.
 *   3. STUCK_NON_TERMINAL   — a payment stuck in PROCESSING / NEEDS_REVIEW /
 *      INITIATED beyond the configured threshold (1 hour). The regular recon
 *      sweeps escalate these too; this sweep gives them a unified presence on the
 *      Reversal Desk so ops never miss them.
 *
 * Each anomaly is recorded ONCE per transaction (deduped via AuditLog check). The
 * admin API reads them, and the Reversal Desk shows them in a dedicated panel.
 * Resolving or reversing the transaction clears it from the feed on the next sweep.
 */
import type { ServiceCode, TxnStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { toNumber } from "@/lib/money";
import { sendOpsAlert } from "@/lib/monitoring/alerts";
import { logger } from "@/lib/logger";
import { flags } from "@/lib/env";
import { getPartner } from "@/lib/partners";
import { rechargekitStatus } from "@/lib/partners/sameday-rechargekit";
import { deriveTxnRefs } from "@/lib/recon/refs";

const log = logger.child({ module: "recon/anomalies" });

const STUCK_THRESHOLD_MS = 60 * 60_000; // 1 hour
const SCAN_WINDOW_MS = 7 * 24 * 3_600_000; // look back 7 days
// SUCCESS verification: check recent SUCCESS bill payments against the provider.
// Window kept short (48h) and min-age applied so we never race a fresh
// settlement, and the provider-call volume stays bounded.
const VERIFY_WINDOW_MS = 48 * 3_600_000; // only verify SUCCESS txns < 48h old
const VERIFY_MIN_AGE_MS = 10 * 60_000; // …and ≥ 10 min old (let settlement settle)
const RK_PARTNER = "SAMEDAY_RECHARGEKIT"; // different rail — excluded from BBPS verify

/** Service rails where a SUCCESS transaction MUST have a partnerTxnId. */
const RAILS_REQUIRING_PARTNER_REF: ServiceCode[] = [
  "BILL_ELECTRICITY",
  "BILL_WATER",
  "BILL_GAS",
  "BILL_CREDIT_CARD",
  "BILL_EDUCATION",
  "BILL_INSURANCE",
  "RECHARGE_BROADBAND",
];

export const ANOMALY_ACTIONS = {
  FAILED_NO_REVERSAL: "anomaly.failed_no_reversal",
  SUCCESS_NO_PROVIDER: "anomaly.success_no_provider",
  DUPLICATE_PROVIDER_REF: "anomaly.duplicate_provider_ref",
  STUCK_NON_TERMINAL: "anomaly.stuck_non_terminal",
  // Outcome-verification anomalies (provider books vs our ledger):
  // PROVIDER_CLAWBACK — we settled SUCCESS but the provider now reports
  //   FAILED/REFUNDED: the rail clawed it back / never settled. Funds captured
  //   from the retailer are at risk → review + corrective action.
  PROVIDER_CLAWBACK: "anomaly.provider_clawback",
  // FALSE_REFUND — we recorded FAILED/REFUNDED (reserve returned) but the
  //   provider reports SUCCESS for the SAME amount: a direct loss (vendor paid,
  //   retailer refunded). Resolve → promote to SUCCESS + lien clawback.
  FALSE_REFUND: "anomaly.false_refund",
  // AMOUNT_MISMATCH — provider confirms a terminal outcome but for a DIFFERENT
  //   amount than the row (twin double-attempt). Needs a human to pick the leg.
  AMOUNT_MISMATCH: "anomaly.amount_mismatch",
} as const;

/** Durable "this terminal row was verified against the provider and agreed"
 *  marker — bounds provider polling to at most once per row (NOT an anomaly,
 *  so it never surfaces on the Reversal Desk). */
const OUTCOME_VERIFIED_ACTION = "recon.txn_outcome_verified";

export type AnomalyType = keyof typeof ANOMALY_ACTIONS;

export type AnomalySweepSummary = {
  ranAt: string;
  failedNoReversal: number;
  successNoProvider: number;
  duplicateProviderRef: number;
  stuckNonTerminal: number;
  total: number;
  /** Anomalies auto-cleared because the underlying txn was resolved. */
  cleared: number;
};

/**
 * Correlation keys for duplicate-charge detection: the stored partnerTxnId
 * (order_id) plus the single-use bill_fetch_ref mined from the pay request.
 * Namespaced (`pt:` / `bfr:`) so a partnerTxnId can never collide with a
 * bill_fetch_ref. Two SUCCESS txns sharing ANY of these are the same payment.
 */
function duplicateRefKeys(partnerTxnId: string | null, request: unknown): string[] {
  const keys: string[] = [];
  const pt = typeof partnerTxnId === "string" ? partnerTxnId.trim() : "";
  if (pt) keys.push(`pt:${pt}`);
  const cp = (request as { customerParams?: Record<string, unknown> } | null)?.customerParams;
  if (cp) {
    const bfr = (cp.billFetchRef ?? cp.bill_fetch_ref) as unknown;
    if (typeof bfr === "string" && bfr.trim()) keys.push(`bfr:${bfr.trim()}`);
  }
  return Array.from(new Set(keys));
}

async function alreadyFlagged(txnId: string, action: string): Promise<boolean> {
  const existing = await prisma.auditLog.findFirst({
    where: { entityId: txnId, action },
    select: { id: true },
  });
  return !!existing;
}

async function flagAnomaly(
  txnId: string,
  userId: string,
  action: string,
  meta: Record<string, unknown>
): Promise<boolean> {
  if (await alreadyFlagged(txnId, action)) return false;
  await prisma.auditLog.create({
    data: {
      userId,
      action,
      entity: "Transaction",
      entityId: txnId,
      meta: { ...meta, detectedAt: new Date().toISOString() },
    },
  });
  return true;
}

/** Stamp a terminal row as provider-verified-OK so it is never re-polled. */
async function markOutcomeVerified(txnId: string, providerStatus: string): Promise<void> {
  await prisma.auditLog.create({
    data: {
      action: OUTCOME_VERIFIED_ACTION,
      entity: "Transaction",
      entityId: txnId,
      meta: { providerStatus, verifiedAt: new Date().toISOString() },
    },
  });
}

export async function runAnomalySweep(): Promise<AnomalySweepSummary> {
  const ranAt = new Date().toISOString();
  const now = Date.now();
  const scanSince = new Date(now - SCAN_WINDOW_MS);
  let failedNoReversal = 0;
  let successNoProvider = 0;
  let duplicateProviderRef = 0;
  let stuckNonTerminal = 0;
  let cleared = 0;

  // ── 1. FAILED / REFUNDED without a wallet REVERSAL ──────────────────────
  // These are the direct money-loss cases: the user's wallet was debited for
  // the reserve (amount + fee) but the failure path didn't credit it back.
  const failedTxns = await prisma.transaction.findMany({
    where: {
      status: { in: ["FAILED", "REFUNDED"] },
      createdAt: { gte: scanSince },
      isSettlement: false,
    },
    select: {
      id: true,
      refId: true,
      userId: true,
      amount: true,
      fee: true,
      service: true,
      status: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  for (const txn of failedTxns) {
    const reversal = await prisma.walletTxn.findFirst({
      where: {
        userId: txn.userId,
        direction: "CREDIT",
        reason: "REVERSAL",
        refType: "Transaction",
        refId: txn.id,
      },
      select: { id: true },
    });
    if (!reversal) {
      const created = await flagAnomaly(txn.id, txn.userId, ANOMALY_ACTIONS.FAILED_NO_REVERSAL, {
        refId: txn.refId,
        amount: toNumber(txn.amount),
        fee: toNumber(txn.fee),
        service: txn.service,
        status: txn.status,
        createdAt: txn.createdAt.toISOString(),
      });
      if (created) failedNoReversal++;
    }
  }

  // ── 2. SUCCESS with no provider record (ACTIVE verification) ────────────
  // A SUCCESS bill-payment the provider has NO record of means our system
  // settled + charged the retailer's wallet but no money actually moved
  // upstream (the idempotent-replay / lost-response class of bug). We VERIFY
  // each recent SUCCESS BBPS txn against the provider's status API using every
  // reference it ever exchanged (partnerTxnId / order_id / request_id /
  // bill_fetch_ref). If ALL of them come back not-found, the provider has no
  // record → flag it.
  //
  // FALSE-POSITIVE GUARD: if the provider is unreachable for the whole batch
  // (outage / IP de-whitelist), every status call fails and we'd wrongly flag
  // every SUCCESS txn. So a txn that HAS references is only flagged once we've
  // confirmed the provider is reachable (≥1 other txn resolved OK). A txn with
  // NO resolvable reference at all is untraceable regardless, so it's always
  // flagged.
  if (flags.bbps) {
    const bbps = getPartner("bbps");
    if (bbps.status) {
      const successTxns = await prisma.transaction.findMany({
        where: {
          status: "SUCCESS",
          service: { in: RAILS_REQUIRING_PARTNER_REF },
          partner: { not: RK_PARTNER },
          isSettlement: false,
          createdAt: {
            gte: new Date(now - VERIFY_WINDOW_MS),
            lt: new Date(now - VERIFY_MIN_AGE_MS),
          },
        },
        select: {
          id: true,
          refId: true,
          userId: true,
          amount: true,
          fee: true,
          service: true,
          partner: true,
          partnerTxnId: true,
          request: true,
          response: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 150,
      });

      let providerReachable = false;
      // Collect "no record" txns with whether they had any ref to check.
      const noRecord: Array<{
        txn: (typeof successTxns)[number];
        hadRefs: boolean;
      }> = [];

      for (const txn of successTxns) {
        // Skip if already flagged (avoids re-querying the provider every sweep).
        if (await alreadyFlagged(txn.id, ANOMALY_ACTIONS.SUCCESS_NO_PROVIDER)) continue;

        const refs = deriveTxnRefs({
          partnerTxnId: txn.partnerTxnId,
          request: txn.request,
          response: txn.response,
        });

        if (refs.length === 0) {
          // No handle at all → provider could never have a trace. Always flag.
          noRecord.push({ txn, hadRefs: false });
          continue;
        }

        let found = false;
        for (const ref of refs) {
          let r = await bbps.status({ orderId: ref });
          if (!r.ok) r = await bbps.status({ requestId: ref });
          if (!r.ok) r = await bbps.status({ billFetchRef: ref });
          if (r.ok) {
            providerReachable = true; // provider answered → it's up
            found = true;
            break;
          }
        }
        if (!found) noRecord.push({ txn, hadRefs: true });
      }

      for (const { txn, hadRefs } of noRecord) {
        // A txn WITH refs is only flagged once we know the provider is reachable
        // (otherwise an outage would mass-flag). A txn with NO refs is always
        // untraceable, so flag it regardless.
        if (hadRefs && !providerReachable) continue;
        const created = await flagAnomaly(txn.id, txn.userId, ANOMALY_ACTIONS.SUCCESS_NO_PROVIDER, {
          refId: txn.refId,
          amount: toNumber(txn.amount),
          fee: toNumber(txn.fee),
          service: txn.service,
          partner: txn.partner,
          partnerTxnId: txn.partnerTxnId,
          hadProviderRefs: hadRefs,
          verifiedVia: hadRefs ? "provider_status_api" : "no_reference",
          createdAt: txn.createdAt.toISOString(),
        });
        if (created) successNoProvider++;
      }
    }
  }

  // ── 2b. DUPLICATE provider reference (idempotent replay) ────────────────
  // The signature of an idempotent replay: TWO or more SUCCESS bill-payments
  // share the SAME provider reference. We key on BOTH:
  //   • partnerTxnId (order_id) — shared when the provider replays the same order
  //   • bill_fetch_ref          — the SINGLE-USE fetch handle; a second SUCCESS
  //                               pay on it is ALWAYS a replay (no new money),
  //                               even if the provider returns a different order_id.
  // Only the EARLIEST transaction in a shared-ref group moved real money; every
  // later sibling double-charged the retailer's wallet. Active provider
  // verification can't catch this (the shared ref legitimately resolves to the
  // original payment), so we detect it structurally. We flag every duplicate
  // EXCEPT the earliest; each flagged one is a refund candidate on the desk.
  const recentSuccess = await prisma.transaction.findMany({
    where: {
      status: "SUCCESS",
      service: { in: RAILS_REQUIRING_PARTNER_REF },
      partner: { not: RK_PARTNER },
      isSettlement: false,
      createdAt: { gte: scanSince },
    },
    select: {
      id: true,
      refId: true,
      userId: true,
      amount: true,
      fee: true,
      service: true,
      partner: true,
      partnerTxnId: true,
      request: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });
  // Group earliest-first so the first txn to use a ref is the "original".
  recentSuccess.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  // Maps a shared reference key → the refId of the EARLIEST txn that used it.
  const refOwner = new Map<string, string>();
  for (const txn of recentSuccess) {
    const keys = duplicateRefKeys(txn.partnerTxnId, txn.request);
    if (keys.length === 0) continue; // nothing to correlate on

    let ownerRefId: string | null = null;
    for (const k of keys) {
      const o = refOwner.get(k);
      if (o) {
        ownerRefId = o;
        break;
      }
    }

    if (ownerRefId) {
      // A prior SUCCESS txn already used one of these refs → this is a duplicate.
      const created = await flagAnomaly(txn.id, txn.userId, ANOMALY_ACTIONS.DUPLICATE_PROVIDER_REF, {
        refId: txn.refId,
        amount: toNumber(txn.amount),
        fee: toNumber(txn.fee),
        service: txn.service,
        partner: txn.partner,
        partnerTxnId: txn.partnerTxnId,
        sharedWithRefId: ownerRefId,
        createdAt: txn.createdAt.toISOString(),
      });
      if (created) duplicateProviderRef++;
      // Register this txn's as-yet-unseen keys to the SAME original so a later
      // transitive sibling still resolves to one original.
      for (const k of keys) if (!refOwner.has(k)) refOwner.set(k, ownerRefId);
    } else {
      // First txn to use these refs → it's the original (the real payment).
      for (const k of keys) refOwner.set(k, txn.refId);
    }
  }

  // ── 3. Stuck in non-terminal state beyond threshold ─────────────────────
  const stuckTxns = await prisma.transaction.findMany({
    where: {
      status: { in: ["INITIATED", "PROCESSING", "NEEDS_REVIEW"] },
      createdAt: { lt: new Date(now - STUCK_THRESHOLD_MS) },
      isSettlement: false,
    },
    select: {
      id: true,
      refId: true,
      userId: true,
      amount: true,
      fee: true,
      service: true,
      status: true,
      createdAt: true,
      partner: true,
    },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  for (const txn of stuckTxns) {
    const created = await flagAnomaly(txn.id, txn.userId, ANOMALY_ACTIONS.STUCK_NON_TERMINAL, {
      refId: txn.refId,
      amount: toNumber(txn.amount),
      fee: toNumber(txn.fee),
      service: txn.service,
      status: txn.status,
      partner: txn.partner,
      ageMinutes: Math.floor((now - txn.createdAt.getTime()) / 60_000),
      createdAt: txn.createdAt.toISOString(),
    });
    if (created) stuckNonTerminal++;
  }

  // ── 4. Auto-clear resolved anomalies ────────────────────────────────────
  // If an anomaly was flagged but the underlying transaction has since been
  // resolved (e.g. manually reversed, reconciled), clear the flag so it drops
  // off the admin feed. We do this by checking if the condition still holds.
  const allAnomalyActions = Object.values(ANOMALY_ACTIONS);
  const openAnomalies = await prisma.auditLog.findMany({
    where: {
      action: { in: allAnomalyActions },
      entity: "Transaction",
      createdAt: { gte: scanSince },
    },
    select: { id: true, action: true, entityId: true },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });

  const seenTxnIds = new Set<string>();
  for (const anomaly of openAnomalies) {
    if (!anomaly.entityId || seenTxnIds.has(anomaly.entityId)) continue;
    seenTxnIds.add(anomaly.entityId);

    const txn = await prisma.transaction.findUnique({
      where: { id: anomaly.entityId },
      select: { id: true, status: true },
    });
    if (!txn) continue;

    let resolved = false;

    if (anomaly.action === ANOMALY_ACTIONS.FAILED_NO_REVERSAL) {
      // Check if a reversal has now been posted
      const rev = await prisma.walletTxn.findFirst({
        where: {
          direction: "CREDIT",
          reason: "REVERSAL",
          refType: "Transaction",
          refId: txn.id,
        },
        select: { id: true },
      });
      if (rev) resolved = true;
      // Also resolved if txn is no longer FAILED/REFUNDED (promoted to SUCCESS)
      if (txn.status === "SUCCESS") resolved = true;
    } else if (
      anomaly.action === ANOMALY_ACTIONS.SUCCESS_NO_PROVIDER ||
      anomaly.action === ANOMALY_ACTIONS.DUPLICATE_PROVIDER_REF
    ) {
      // Cleared once the txn has been reversed/refunded (admin raised a reversal,
      // or a REVERSAL credit was posted) — the money is back with the retailer.
      if (txn.status === "FAILED" || txn.status === "REFUNDED") resolved = true;
      const rev = await prisma.walletTxn.findFirst({
        where: {
          direction: "CREDIT",
          reason: "REVERSAL",
          refType: "Transaction",
          refId: txn.id,
        },
        select: { id: true },
      });
      if (rev) resolved = true;
    } else if (anomaly.action === ANOMALY_ACTIONS.STUCK_NON_TERMINAL) {
      // Resolved if the txn has reached a terminal state
      if (txn.status === "SUCCESS" || txn.status === "FAILED" || txn.status === "REFUNDED") {
        resolved = true;
      }
    } else if (anomaly.action === ANOMALY_ACTIONS.PROVIDER_CLAWBACK) {
      // We flagged a SUCCESS the provider had clawed back. Cleared once an
      // operator has acted — the row is no longer a plain SUCCESS (reversed /
      // corrected) or a lien now covers the captured funds.
      if (txn.status !== "SUCCESS") resolved = true;
      else {
        const lien = await prisma.walletLien.findFirst({
          where: { refType: "Transaction", refId: txn.id },
          select: { id: true },
        });
        if (lien) resolved = true;
      }
    } else if (
      anomaly.action === ANOMALY_ACTIONS.FALSE_REFUND ||
      anomaly.action === ANOMALY_ACTIONS.AMOUNT_MISMATCH
    ) {
      // Cleared once the row has been corrected to SUCCESS (the resolver promotes
      // + lien-claws-back a confirmed false refund).
      if (txn.status === "SUCCESS") resolved = true;
    }

    if (resolved) {
      // Idempotency guard: if the delete silently failed on a prior sweep (e.g.
      // pgbouncer replication lag / swallowed error), the original anomaly stays
      // and the sweep would create a duplicate .cleared entry every 5 min.
      // Skip creating another .cleared if one already exists for this anomaly id.
      const alreadyCleared = await prisma.auditLog.findFirst({
        where: {
          action: `${anomaly.action}.cleared`,
          entity: "Transaction",
          entityId: txn.id,
        },
        select: { id: true },
      });
      if (!alreadyCleared) {
        await prisma.auditLog.create({
          data: {
            action: `${anomaly.action}.cleared`,
            entity: "Transaction",
            entityId: txn.id,
            meta: { originalAnomalyId: anomaly.id, clearedAt: new Date().toISOString() },
          },
        });
        cleared++;
      }
      // Delete the original anomaly so it drops from the feed.
      // Log failures instead of silently swallowing them — a failed delete leaves
      // the original in place and causes the duplicate-cleared loop above.
      await prisma.auditLog.delete({ where: { id: anomaly.id } }).catch((e) => {
        log.warn({ action: "anomaly.clear.delete_failed", anomalyId: anomaly.id, err: String(e) });
      });
    }
  }

  const total = failedNoReversal + successNoProvider + duplicateProviderRef + stuckNonTerminal;

  // Alert ops if new anomalies were found (batched, not per-txn).
  if (total > 0) {
    const moneyLoss = failedNoReversal > 0 || successNoProvider > 0 || duplicateProviderRef > 0;
    void sendOpsAlert({
      title: `${total} new transaction anomal${total === 1 ? "y" : "ies"} detected`,
      severity: moneyLoss ? "critical" : "warning",
      details: {
        failedNoReversal,
        successNoProvider,
        duplicateProviderRef,
        stuckNonTerminal,
        cleared,
        hint: "Review on the Reversal Desk → Auto-detected Issues.",
      },
    }).catch(() => {});
    log.warn(
      { failedNoReversal, successNoProvider, duplicateProviderRef, stuckNonTerminal, cleared },
      "anomalies detected"
    );
  }

  const summary: AnomalySweepSummary = {
    ranAt,
    failedNoReversal,
    successNoProvider,
    duplicateProviderRef,
    stuckNonTerminal,
    total,
    cleared,
  };

  await prisma.auditLog.create({
    data: { action: "recon.anomaly_sweep", entity: "System", meta: { ...summary } },
  });

  return summary;
}

// Outcome verification scans a wider terminal window than the SUCCESS-only check,
// but bounds cost via the one-shot OUTCOME_VERIFIED marker (each row polled once).
const OUTCOME_VERIFY_WINDOW_MS = 72 * 3_600_000; // re-check terminal rows < 72h old
const OUTCOME_VERIFY_MIN_AGE_MS = 15 * 60_000; // …and ≥ 15 min old (let it settle)

export type OutcomeVerifySummary = {
  ranAt: string;
  scanned: number;
  providerClawback: number;
  falseRefund: number;
  amountMismatch: number;
  verifiedOk: number;
};

/**
 * Proactive clawback / false-refund / amount-mismatch detector.
 *
 * Re-polls recent TERMINAL service rows (SUCCESS / FAILED / REFUNDED on the
 * BBPS + RechargeKit rails) against the provider's own status API and compares
 * the authoritative outcome — and amount — to our ledger:
 *
 *   • we SUCCESS, provider FAILED/REFUNDED  → PROVIDER_CLAWBACK (captured funds
 *     at risk; the rail reversed or never settled).
 *   • we FAILED/REFUNDED, provider SUCCESS (same amount) → FALSE_REFUND (the
 *     direct-loss incident: vendor paid, retailer refunded).
 *   • provider terminal but a DIFFERENT amount → AMOUNT_MISMATCH (twin attempt).
 *
 * It NEVER moves money — findings land on the Reversal Desk (same AuditLog
 * anomaly namespace) + a critical ops alert, for a deliberate operator action.
 * Each row is polled at most once (OUTCOME_VERIFIED marker) so provider load
 * stays bounded; a definitive provider answer is required before any flag, so a
 * provider outage can never mass-flag.
 */
export async function runOutcomeVerificationSweep(): Promise<OutcomeVerifySummary> {
  const ranAt = new Date().toISOString();
  const now = Date.now();
  let scanned = 0;
  let providerClawback = 0;
  let falseRefund = 0;
  let amountMismatch = 0;
  let verifiedOk = 0;

  const bbps = flags.bbps ? getPartner("bbps") : null;

  const rows = await prisma.transaction.findMany({
    where: {
      status: { in: ["SUCCESS", "FAILED", "REFUNDED"] },
      isSettlement: false,
      OR: [
        { service: { in: RAILS_REQUIRING_PARTNER_REF }, partner: { not: RK_PARTNER } },
        { partner: RK_PARTNER },
      ],
      createdAt: {
        gte: new Date(now - OUTCOME_VERIFY_WINDOW_MS),
        lt: new Date(now - OUTCOME_VERIFY_MIN_AGE_MS),
      },
    },
    select: {
      id: true,
      refId: true,
      userId: true,
      amount: true,
      fee: true,
      service: true,
      status: true,
      partner: true,
      partnerTxnId: true,
      request: true,
      response: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  for (const txn of rows) {
    // Skip rows already verified-ok or already carrying an outcome anomaly.
    if (await alreadyFlagged(txn.id, OUTCOME_VERIFIED_ACTION)) continue;
    if (await alreadyFlagged(txn.id, ANOMALY_ACTIONS.PROVIDER_CLAWBACK)) continue;
    if (await alreadyFlagged(txn.id, ANOMALY_ACTIONS.FALSE_REFUND)) continue;
    if (await alreadyFlagged(txn.id, ANOMALY_ACTIONS.AMOUNT_MISMATCH)) continue;

    const refs = deriveTxnRefs({
      partnerTxnId: txn.partnerTxnId,
      request: txn.request,
      response: txn.response,
    });
    if (refs.length === 0) continue; // no handle to poll (no-ref SUCCESS handled elsewhere)

    const isRk = txn.partner === RK_PARTNER;
    let provStatus: "SUCCESS" | "PENDING" | "FAILED" | "REFUNDED" | null = null;
    let provAmount: number | null = null;
    try {
      for (const ref of refs) {
        if (isRk) {
          let r = await rechargekitStatus({ txnId: ref });
          if (!r.ok) r = await rechargekitStatus({ requestId: ref });
          if (r.ok) {
            provStatus = r.data.status;
            provAmount = typeof r.data.amount === "number" && r.data.amount > 0 ? r.data.amount : null;
            break;
          }
        } else {
          if (!bbps?.status) break;
          let r = await bbps.status({ orderId: ref });
          if (!r.ok) r = await bbps.status({ requestId: ref });
          if (!r.ok) r = await bbps.status({ billFetchRef: ref });
          if (r.ok) {
            provStatus = r.data.status;
            provAmount = typeof r.data.amount === "number" && r.data.amount > 0 ? r.data.amount : null;
            break;
          }
        }
      }
    } catch (e) {
      log.warn({ refId: txn.refId, err: String(e) }, "outcome verify: provider poll failed");
      continue;
    }

    scanned++;
    if (!provStatus || provStatus === "PENDING") continue; // inconclusive → retry later

    const rowAmt = toNumber(txn.amount);
    const amountOk = provAmount == null || Math.abs(provAmount - rowAmt) <= 0.01;
    const weSucceeded = txn.status === "SUCCESS";
    const meta = {
      refId: txn.refId,
      amount: rowAmt,
      fee: toNumber(txn.fee),
      service: txn.service,
      partner: txn.partner,
      partnerTxnId: txn.partnerTxnId,
      ourStatus: txn.status,
      providerStatus: provStatus,
      providerAmount: provAmount,
      createdAt: txn.createdAt.toISOString(),
    };

    if (provStatus === "SUCCESS") {
      if (!amountOk) {
        if (await flagAnomaly(txn.id, txn.userId, ANOMALY_ACTIONS.AMOUNT_MISMATCH, meta)) amountMismatch++;
      } else if (weSucceeded) {
        await markOutcomeVerified(txn.id, provStatus);
        verifiedOk++;
      } else {
        // We refunded/failed it but the provider paid → direct loss.
        if (await flagAnomaly(txn.id, txn.userId, ANOMALY_ACTIONS.FALSE_REFUND, meta)) falseRefund++;
      }
    } else {
      // provider FAILED / REFUNDED
      if (weSucceeded) {
        if (await flagAnomaly(txn.id, txn.userId, ANOMALY_ACTIONS.PROVIDER_CLAWBACK, meta)) providerClawback++;
      } else {
        await markOutcomeVerified(txn.id, provStatus);
        verifiedOk++;
      }
    }
  }

  const total = providerClawback + falseRefund + amountMismatch;
  if (total > 0) {
    void sendOpsAlert({
      title: `${total} payment outcome mismatch(es) vs provider detected`,
      severity: "critical",
      details: {
        providerClawback,
        falseRefund,
        amountMismatch,
        verifiedOk,
        hint: "Review on the Reversal Desk → Auto-detected Issues, then Resolve / verify.",
      },
    }).catch(() => {});
    log.warn({ providerClawback, falseRefund, amountMismatch, verifiedOk }, "outcome mismatches detected");
  }

  const summary: OutcomeVerifySummary = {
    ranAt,
    scanned,
    providerClawback,
    falseRefund,
    amountMismatch,
    verifiedOk,
  };
  await prisma.auditLog.create({
    data: { action: "recon.outcome_verify", entity: "System", meta: { ...summary } },
  });
  return summary;
}

/**
 * Total open-anomaly exposure (count of flagged txns + Σ amount+fee). Cleared
 * anomalies are deleted from AuditLog, so the remaining flags are the open set.
 * Used by the money-at-risk dashboard.
 */
export async function getAnomalyExposure(): Promise<{ count: number; exposure: number }> {
  const allActions = Object.values(ANOMALY_ACTIONS);
  const logs = await prisma.auditLog.findMany({
    where: { action: { in: allActions }, entity: "Transaction" },
    select: { entityId: true },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });
  const ids = [
    ...new Set(logs.map((l) => l.entityId).filter((x): x is string => !!x)),
  ];
  if (ids.length === 0) return { count: 0, exposure: 0 };
  const txns = await prisma.transaction.findMany({
    where: { id: { in: ids } },
    select: { amount: true, fee: true },
  });
  let exposure = 0;
  for (const t of txns) exposure += toNumber(t.amount) + toNumber(t.fee);
  return { count: txns.length, exposure };
}

/** Read open anomalies for the admin UI. */
export async function getOpenAnomalies(opts?: { page?: number; pageSize?: number }): Promise<{
  items: Array<{
    id: string;
    type: AnomalyType;
    action: string;
    txnId: string;
    refId: string;
    amount: number;
    fee: number;
    service: string;
    status: string;
    partner: string | null;
    detectedAt: string;
    ageMinutes: number;
    user: { name: string; email: string; userCode: string | null } | null;
  }>;
  total: number;
  exposure: number;
}> {
  const page = opts?.page ?? 1;
  const pageSize = opts?.pageSize ?? 50;
  const allActions = Object.values(ANOMALY_ACTIONS);

  const [anomalyLogs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where: {
        action: { in: allActions },
        entity: "Transaction",
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({
      where: { action: { in: allActions }, entity: "Transaction" },
    }),
  ]);

  const txnIds = anomalyLogs.map((a) => a.entityId).filter((id): id is string => !!id);
  const txns = txnIds.length
    ? await prisma.transaction.findMany({
        where: { id: { in: txnIds } },
        select: {
          id: true,
          refId: true,
          amount: true,
          fee: true,
          service: true,
          status: true,
          partner: true,
          user: { select: { name: true, email: true, userCode: true } },
        },
      })
    : [];
  const txnMap = new Map(txns.map((t) => [t.id, t]));

  const actionToType: Record<string, AnomalyType> = {};
  for (const [key, action] of Object.entries(ANOMALY_ACTIONS)) {
    actionToType[action] = key as AnomalyType;
  }

  const now = Date.now();
  let exposure = 0;
  const items = anomalyLogs
    .filter((a) => a.entityId && txnMap.has(a.entityId))
    .map((a) => {
      const txn = txnMap.get(a.entityId!)!;
      const amt = toNumber(txn.amount);
      const fee = toNumber(txn.fee);
      exposure += amt + fee;
      return {
        id: a.id,
        type: actionToType[a.action] ?? ("STUCK_NON_TERMINAL" as AnomalyType),
        action: a.action,
        txnId: txn.id,
        refId: txn.refId,
        amount: amt,
        fee,
        service: txn.service,
        status: txn.status,
        partner: txn.partner,
        detectedAt: a.createdAt.toISOString(),
        ageMinutes: Math.floor((now - a.createdAt.getTime()) / 60_000),
        user: txn.user,
      };
    });

  return { items, total, exposure };
}
