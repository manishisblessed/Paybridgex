import type { ServiceCode } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getPartner } from "@/lib/partners";
import {
  finalizeServiceTransaction,
  correctTerminalToSuccess,
  FINALIZABLE_TXN_SELECT,
} from "@/lib/services/finalize";
import { reconcileRechargekitFromWebhook } from "@/lib/recon/rechargekit";
import { rechargekitStatus } from "@/lib/partners/sameday-rechargekit";
import { deriveTxnRefs } from "@/lib/recon/refs";
import { recoverRefsFromApiLog } from "@/lib/recon/recover";
import { logger } from "@/lib/logger";

const log = logger.child({ module: "recon/reconcileOne" });

/** Every RechargeKit (CC-2) transaction carries this partner tag. */
const RK_PARTNER = "SAMEDAY_RECHARGEKIT";

/** Services settled over the BBPS (Bharat BillPay / Pay2New) rail. */
const BBPS_SERVICES = new Set<ServiceCode>([
  "BILL_ELECTRICITY",
  "BILL_WATER",
  "BILL_GAS",
  "BILL_CREDIT_CARD",
  "BILL_EDUCATION",
  "BILL_INSURANCE",
  "RECHARGE_BROADBAND",
]);

type Outcome = "settled" | "refunded" | "pending" | "noop";

function normalizeOutcome(o: string | undefined): Outcome {
  return o === "settled" || o === "refunded" || o === "pending" ? o : "noop";
}

export type ReconcileOneResult =
  | { found: false }
  | {
      found: true;
      refId: string;
      /** Row was already terminal before this call (nothing to do). */
      alreadyTerminal: boolean;
      /** Status BEFORE this call. */
      status: string;
      rail: "rechargekit" | "bbps" | "unsupported";
      outcome: "settled" | "refunded" | "pending" | "noop";
    };

/**
 * Force-reconcile ONE service transaction by reference — the safe, targeted
 * counterpart to the scheduled sweeps, for support/ops.
 *
 * Accepts our internal `refId` (e.g. `TXN…`) OR the provider `partnerTxnId`.
 * Always RE-POLLS the provider's own status API before touching the ledger and
 * finalizes through the shared idempotent finalizer, so it NEVER blind-refunds a
 * card that may actually have been charged, and racing with the webhook/sweep is
 * a safe no-op.
 */
export async function reconcileOneTransaction(
  ref: string,
  opts: { ownerUserId?: string; source?: string } = {}
): Promise<ReconcileOneResult> {
  const source = opts.source ?? "admin_recon";
  const needle = ref.trim();
  if (!needle) return { found: false };

  const row = await prisma.transaction.findFirst({
    where: {
      OR: [{ refId: needle }, { partnerTxnId: needle }],
      // Scope to a single user's own transaction for retailer self-service.
      ...(opts.ownerUserId ? { userId: opts.ownerUserId } : {}),
    },
    select: { ...FINALIZABLE_TXN_SELECT, request: true, response: true },
  });
  if (!row) return { found: false };

  const { request, response, ...txn } = row;

  const rail: "rechargekit" | "bbps" | "unsupported" =
    txn.partner === RK_PARTNER
      ? "rechargekit"
      : BBPS_SERVICES.has(txn.service)
        ? "bbps"
        : "unsupported";

  // Already terminal → nothing to do. NEEDS_REVIEW is NON-terminal (held,
  // awaiting an authoritative outcome), so it remains resolvable here.
  if (txn.status !== "INITIATED" && txn.status !== "PROCESSING" && txn.status !== "NEEDS_REVIEW") {
    return { found: true, refId: txn.refId, alreadyTerminal: true, status: txn.status, rail, outcome: "noop" };
  }

  // ── RechargeKit CC-2 ──────────────────────────────────────────────────────
  if (rail === "rechargekit") {
    // Every candidate handle: partnerTxnId + anything mined from the pay
    // request/response, plus our own refId (a valid webhook correlation key).
    const refs = Array.from(
      new Set(
        [...deriveTxnRefs({ partnerTxnId: txn.partnerTxnId, request, response }), txn.refId].filter(Boolean)
      )
    );
    const r = await reconcileRechargekitFromWebhook(refs, source);
    const outcome = normalizeOutcome(r.outcome);
    return { found: true, refId: txn.refId, alreadyTerminal: false, status: txn.status, rail, outcome };
  }

  // ── BBPS (Bharat BillPay / Pay2New) ───────────────────────────────────────
  if (rail === "bbps") {
    const bbps = getPartner("bbps");
    // Recover a poll reference from partnerTxnId OR the stored request/response
    // (Pay2New's bill_fetch_ref) so a row with a blank partnerTxnId — a pay that
    // died before persisting the partner result — is still resolvable here.
    const refs = deriveTxnRefs({ partnerTxnId: txn.partnerTxnId, request, response });
    if (!bbps.status || refs.length === 0) {
      log.warn({ refId: txn.refId }, "BBPS reconcile: no status method or provider ref");
      return { found: true, refId: txn.refId, alreadyTerminal: false, status: txn.status, rail, outcome: "noop" };
    }
    let s: Awaited<ReturnType<NonNullable<typeof bbps.status>>> | null = null;
    let resolvedRef: string | null = null;
    for (const ref of refs) {
      let r = await bbps.status({ orderId: ref });
      if (!r.ok) r = await bbps.status({ requestId: ref });
      if (!r.ok) r = await bbps.status({ billFetchRef: ref });
      if (r.ok) {
        s = r;
        // Prefer the authoritative pay-step ref the provider echoed.
        resolvedRef = r.data.orderId ?? r.data.requestId ?? ref;
        break;
      }
    }
    if (!s || !s.ok) {
      return { found: true, refId: txn.refId, alreadyTerminal: false, status: txn.status, rail, outcome: "noop" };
    }
    if (s.data.status === "PENDING") {
      // Pending stays pending until the provider returns a terminal state.
      return { found: true, refId: txn.refId, alreadyTerminal: false, status: txn.status, rail, outcome: "pending" };
    }
    const res = await finalizeServiceTransaction({
      txn,
      status: s.data.status, // SUCCESS | FAILED | REFUNDED
      partnerTxnId: txn.partnerTxnId ?? resolvedRef,
      errorCode: s.data.status === "SUCCESS" ? null : "BBPS_PROVIDER_FAILED",
      errorMessage:
        s.data.status === "SUCCESS"
          ? null
          : `Bill payment ${s.data.status.toLowerCase()} by provider`,
      raw: s.raw,
      source,
    });
    return {
      found: true,
      refId: txn.refId,
      alreadyTerminal: false,
      status: txn.status,
      rail,
      outcome: res.outcome === "noop" ? "noop" : res.outcome,
    };
  }

  // Unsupported rail (PG/POS/QR/payout are finalized by their own pipelines).
  return { found: true, refId: txn.refId, alreadyTerminal: false, status: txn.status, rail, outcome: "noop" };
}

type ProviderStatus = "SUCCESS" | "FAILED" | "REFUNDED" | "PENDING";

/** Poll the rail's status API across candidate refs; first authoritative wins. */
async function resolveProviderStatus(
  rail: "rechargekit" | "bbps",
  refs: string[]
): Promise<{ status: ProviderStatus; ref: string; payRef: string | null; raw: unknown } | null> {
  for (const ref of refs) {
    if (rail === "bbps") {
      const bbps = getPartner("bbps");
      if (!bbps.status) return null;
      // order_id → request_id → bill_fetch_ref (the ref we always retain).
      let r = await bbps.status({ orderId: ref });
      if (!r.ok) r = await bbps.status({ requestId: ref });
      if (!r.ok) r = await bbps.status({ billFetchRef: ref });
      if (r.ok) return { status: r.data.status, ref, payRef: r.data.orderId ?? r.data.requestId ?? null, raw: r.raw };
    } else {
      let r = await rechargekitStatus({ txnId: ref });
      if (!r.ok) r = await rechargekitStatus({ requestId: ref });
      if (r.ok) return { status: r.data.status, ref, payRef: r.data.txnId ?? null, raw: r.raw };
    }
  }
  return null;
}

export type CorrectOneResult =
  | { found: false }
  | {
      found: true;
      refId: string;
      rail: "rechargekit" | "bbps" | "unsupported";
      /** Row status BEFORE this call. */
      status: string;
      /** Provider's authoritative status, or "UNRESOLVED" when no ref resolved. */
      providerStatus: ProviderStatus | "UNRESOLVED" | "NOT_POLLED";
      outcome:
        | "corrected" // FAILED/REFUNDED → SUCCESS (clawback if a refund existed)
        | "settled" // non-terminal → SUCCESS
        | "refunded" // non-terminal → FAILED/REFUNDED
        | "noop" // already consistent with the provider
        | "unresolved" // provider could not confirm from any available ref
        | "not_applicable"; // unsupported rail
      clawback?: { placed: boolean; refunded: number; lienId: string | null };
    };

/**
 * CORRECTIVE single-txn resolver — the admin-triggered counterpart to
 * {@link reconcileOneTransaction} that can also repair an ALREADY-TERMINAL
 * FAILED/REFUNDED row (the direct-financial-loss case).
 *
 * It always RE-VERIFIES the outcome against the provider's own status API before
 * moving any money — so a correction is "through the API, not manual". For the
 * lost-pay-response case (the status API can't be keyed from the surviving
 * bill_fetch_ref → ORDER_NOT_FOUND), an admin who has read the true outcome +
 * pay-step reference from the provider panel can pass `providerRef`; we then
 * confirm SUCCESS via the API using that ref and auto-settle + auto-clawback
 * (lien-based, never negative) through {@link correctTerminalToSuccess}.
 */
export async function correctOneTransaction(
  ref: string,
  opts: { actorId: string; providerRef?: string; source?: string; remarks?: string }
): Promise<CorrectOneResult> {
  const source = opts.source ?? "admin_resolve";
  const needle = ref.trim();
  if (!needle) return { found: false };

  const row = await prisma.transaction.findFirst({
    where: { OR: [{ refId: needle }, { partnerTxnId: needle }] },
    select: { ...FINALIZABLE_TXN_SELECT, request: true, response: true },
  });
  if (!row) return { found: false };

  const { request, response, ...txn } = row;
  const rail: "rechargekit" | "bbps" | "unsupported" =
    txn.partner === RK_PARTNER
      ? "rechargekit"
      : BBPS_SERVICES.has(txn.service)
        ? "bbps"
        : "unsupported";

  if (rail === "unsupported") {
    return { found: true, refId: txn.refId, rail, status: txn.status, providerStatus: "NOT_POLLED", outcome: "not_applicable" };
  }

  // Candidate poll refs: admin-supplied ref FIRST (it's the recovered pay-step
  // key), then in-row refs, then anything mined from the durable PartnerApiLog.
  const candidates = Array.from(
    new Set(
      [
        opts.providerRef?.trim() ?? "",
        ...deriveTxnRefs({ partnerTxnId: txn.partnerTxnId, request, response }),
        ...(await recoverRefsFromApiLog(txn.refId)),
      ].filter((s) => s && s.length > 0)
    )
  );

  const resolved = candidates.length ? await resolveProviderStatus(rail, candidates) : null;
  if (!resolved) {
    return { found: true, refId: txn.refId, rail, status: txn.status, providerStatus: "UNRESOLVED", outcome: "unresolved" };
  }

  const isTerminalFailed = txn.status === "FAILED" || txn.status === "REFUNDED";
  const partnerTxnId = txn.partnerTxnId ?? resolved.payRef ?? resolved.ref;

  // Provider confirms the money DID move.
  if (resolved.status === "SUCCESS") {
    if (isTerminalFailed) {
      const r = await correctTerminalToSuccess({
        txn,
        partnerTxnId,
        raw: resolved.raw,
        actorId: opts.actorId,
        source,
        remarks: opts.remarks,
      });
      return {
        found: true,
        refId: txn.refId,
        rail,
        status: txn.status,
        providerStatus: "SUCCESS",
        outcome: r.corrected ? "corrected" : "noop",
        clawback: { placed: r.clawbackPlaced, refunded: r.refunded, lienId: r.lienId },
      };
    }
    // Non-terminal → ordinary SUCCESS settlement (no refund was ever issued).
    const res = await finalizeServiceTransaction({ txn, status: "SUCCESS", partnerTxnId, raw: resolved.raw, source });
    return { found: true, refId: txn.refId, rail, status: txn.status, providerStatus: "SUCCESS", outcome: res.finalized ? "settled" : "noop" };
  }

  if (resolved.status === "PENDING") {
    return { found: true, refId: txn.refId, rail, status: txn.status, providerStatus: "PENDING", outcome: "noop" };
  }

  // Provider confirms FAILED/REFUNDED.
  if (isTerminalFailed) {
    // Already consistent — our row is terminal-failed and so is the provider.
    return { found: true, refId: txn.refId, rail, status: txn.status, providerStatus: resolved.status, outcome: "noop" };
  }
  const res = await finalizeServiceTransaction({
    txn,
    status: resolved.status,
    partnerTxnId,
    errorCode: rail === "bbps" ? "BBPS_PROVIDER_FAILED" : "RK_PROVIDER_FAILED",
    errorMessage: `Payment ${resolved.status.toLowerCase()} by provider`,
    raw: resolved.raw,
    source,
  });
  return { found: true, refId: txn.refId, rail, status: txn.status, providerStatus: resolved.status, outcome: res.finalized ? "refunded" : "noop" };
}
