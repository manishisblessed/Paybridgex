import type { ServiceCode } from "@prisma/client";
import { prisma } from "@/lib/db";
import { flags } from "@/lib/env";
import { getPartner } from "@/lib/partners";
import {
  correctTerminalToSuccess,
  finalizeServiceTransaction,
  FINALIZABLE_TXN_SELECT,
} from "@/lib/services/finalize";
import { deriveTxnRefs } from "@/lib/recon/refs";
import { logger } from "@/lib/logger";

const log = logger.child({ module: "recon/payIdempotencyRecovery" });

const BBPS_SERVICES = new Set<ServiceCode>([
  "BILL_ELECTRICITY",
  "BILL_WATER",
  "BILL_GAS",
  "BILL_CREDIT_CARD",
  "BILL_EDUCATION",
  "BILL_INSURANCE",
  "RECHARGE_BROADBAND",
]);

type StoredBbpsRequest = {
  billerCode?: string;
  category?: string;
  customerParams?: Record<string, string>;
  amount?: number;
  /** Original caller idempotency key — reused so an idempotent provider echoes
   * the original result instead of creating a second payment. */
  idempotencyKey?: string;
};

export type PayRecoveryResult = {
  attempted: boolean;
  /** Why a recovery was NOT attempted (flag off / unsupported / no ref). */
  skipped?: string;
  outcome?: "corrected" | "settled" | "refunded" | "pending" | "noop";
  providerStatus?: "SUCCESS" | "PENDING" | "FAILED" | "REFUNDED";
  clawback?: { placed: boolean; refunded: number; lienId: string | null };
};

/**
 * LAST-RESORT recovery for a lost-response payment via PAY IDEMPOTENCY.
 *
 * ⚠️  DANGEROUS — DISABLED BY DEFAULT ⚠️
 *
 * When a pay response is lost mid-flight the provider's STATUS API cannot resolve
 * the payment (the pay-step order_id/request_id died with the response, and the
 * surviving bill_fetch_ref is a FETCH-step key the status API rejects with
 * ORDER_NOT_FOUND). The ONLY way to learn the true outcome purely through the API
 * is to RE-CALL pay with the original `bill_fetch_ref` and rely on the provider
 * being IDEMPOTENT on it — i.e. returning the SAME result for the already-made
 * payment instead of charging the customer a SECOND time.
 *
 * SameDay's BBPS/Pay2New guide does NOT document such idempotency. Until SameDay
 * confirms in writing that a repeated pay on the same bill_fetch_ref is a no-op
 * that echoes the original result, enabling this risks a DOUBLE charge. It is
 * therefore gated behind `flags.samedayPayIdempotencyRecovery` (env
 * SAMEDAY_PAY_IDEMPOTENCY_RECOVERY_ENABLED) and is NOT wired into any automated
 * sweep — it can only ever run when an operator explicitly turns it on.
 */
export async function attemptPayIdempotencyRecovery(
  refId: string,
  opts: { actorId: string; source?: string }
): Promise<PayRecoveryResult> {
  if (!flags.samedayPayIdempotencyRecovery) {
    return { attempted: false, skipped: "feature_disabled" };
  }

  const source = opts.source ?? "pay_idempotency_recovery";
  const row = await prisma.transaction.findFirst({
    where: { OR: [{ refId: refId.trim() }, { partnerTxnId: refId.trim() }] },
    select: { ...FINALIZABLE_TXN_SELECT, request: true, response: true },
  });
  if (!row) return { attempted: false, skipped: "not_found" };

  const { request, response, ...txn } = row;

  // Only the BBPS/Pay2New rail carries a client-side re-call key (bill_fetch_ref).
  // RechargeKit has NO such correlation key, so a lost pay is unrecoverable this
  // way and must never be blindly re-paid.
  if (!(txn.partner !== "SAMEDAY_RECHARGEKIT" && BBPS_SERVICES.has(txn.service))) {
    return { attempted: false, skipped: "unsupported_rail" };
  }

  const req = (request ?? {}) as StoredBbpsRequest;
  const billFetchRef = req.customerParams?.billFetchRef;
  if (!billFetchRef || !req.billerCode || !req.category) {
    return { attempted: false, skipped: "missing_bill_fetch_ref" };
  }

  const bbps = getPartner("bbps");
  log.warn(
    { refId: txn.refId, billFetchRef },
    "PAY IDEMPOTENCY RECOVERY ENABLED — re-calling pay on bill_fetch_ref (provider MUST be idempotent)"
  );

  // Re-invoke pay with the SAME bill_fetch_ref. If the provider is idempotent it
  // echoes the original result; the response's order_id/request_id then lets us
  // poll the authoritative status and finalise.
  const payRes = await bbps.pay({
    userId: txn.userId,
    // Reuse the ORIGINAL idempotency key — this is the whole safety premise: an
    // idempotent provider must treat the re-call as the same payment.
    idempotencyKey: req.idempotencyKey ?? txn.refId,
    billerCode: req.billerCode,
    category: req.category as Parameters<typeof bbps.pay>[0]["category"],
    customerParams: req.customerParams ?? {},
    amount: req.amount ?? txn.amount.toNumber(),
    remark: `Idempotency recovery for ${txn.refId}`,
  });

  // Gather every poll candidate the re-pay produced plus the row's own refs.
  const candidateRefs = Array.from(
    new Set(
      [
        payRes.ok ? payRes.partnerTxnId ?? "" : "",
        ...deriveTxnRefs({ partnerTxnId: txn.partnerTxnId, request, response }),
      ].filter((s) => s && s.length > 0)
    )
  );

  if (!bbps.status || candidateRefs.length === 0) {
    return { attempted: true, outcome: "noop" };
  }

  let resolved: { status: "SUCCESS" | "PENDING" | "FAILED" | "REFUNDED"; ref: string; payRef: string | null; raw: unknown } | null = null;
  for (const ref of candidateRefs) {
    let r = await bbps.status({ orderId: ref });
    if (!r.ok) r = await bbps.status({ requestId: ref });
    if (!r.ok) r = await bbps.status({ billFetchRef: ref });
    if (r.ok) {
      resolved = { status: r.data.status, ref, payRef: r.data.orderId ?? r.data.requestId ?? null, raw: r.raw };
      break;
    }
  }
  if (!resolved) return { attempted: true, outcome: "noop" };

  const partnerTxnId = txn.partnerTxnId ?? resolved.payRef ?? resolved.ref;
  const isTerminalFailed = txn.status === "FAILED" || txn.status === "REFUNDED";

  if (resolved.status === "SUCCESS") {
    if (isTerminalFailed) {
      const r = await correctTerminalToSuccess({
        txn,
        partnerTxnId,
        raw: resolved.raw,
        actorId: opts.actorId,
        source,
        remarks: `Pay-idempotency recovery for ${txn.refId}`,
      });
      return {
        attempted: true,
        providerStatus: "SUCCESS",
        outcome: r.corrected ? "corrected" : "noop",
        clawback: { placed: r.clawbackPlaced, refunded: r.refunded, lienId: r.lienId },
      };
    }
    const res = await finalizeServiceTransaction({ txn, status: "SUCCESS", partnerTxnId, raw: resolved.raw, source });
    return { attempted: true, providerStatus: "SUCCESS", outcome: res.finalized ? "settled" : "noop" };
  }

  if (resolved.status === "PENDING") {
    return { attempted: true, providerStatus: "PENDING", outcome: "pending" };
  }

  // Provider confirms FAILED/REFUNDED — only a non-terminal row needs refunding.
  if (isTerminalFailed) {
    return { attempted: true, providerStatus: resolved.status, outcome: "noop" };
  }
  const res = await finalizeServiceTransaction({
    txn,
    status: resolved.status,
    partnerTxnId,
    errorCode: "BBPS_PROVIDER_FAILED",
    errorMessage: `Bill payment ${resolved.status.toLowerCase()} by provider`,
    raw: resolved.raw,
    source,
  });
  return { attempted: true, providerStatus: resolved.status, outcome: res.finalized ? "refunded" : "noop" };
}
