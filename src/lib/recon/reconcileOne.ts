import type { ServiceCode } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getPartner } from "@/lib/partners";
import {
  finalizeServiceTransaction,
  FINALIZABLE_TXN_SELECT,
} from "@/lib/services/finalize";
import { reconcileRechargekitFromWebhook, refsFromResponse } from "@/lib/recon/rechargekit";
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
    select: { ...FINALIZABLE_TXN_SELECT, response: true },
  });
  if (!row) return { found: false };

  const { response, ...txn } = row;

  const rail: "rechargekit" | "bbps" | "unsupported" =
    txn.partner === RK_PARTNER
      ? "rechargekit"
      : BBPS_SERVICES.has(txn.service)
        ? "bbps"
        : "unsupported";

  // Already terminal → nothing to do.
  if (txn.status !== "INITIATED" && txn.status !== "PROCESSING") {
    return { found: true, refId: txn.refId, alreadyTerminal: true, status: txn.status, rail, outcome: "noop" };
  }

  // ── RechargeKit CC-2 ──────────────────────────────────────────────────────
  if (rail === "rechargekit") {
    const refs = [txn.partnerTxnId ?? "", txn.refId, ...refsFromResponse(response)].filter(Boolean);
    const r = await reconcileRechargekitFromWebhook(refs, source);
    const outcome = normalizeOutcome(r.outcome);
    return { found: true, refId: txn.refId, alreadyTerminal: false, status: txn.status, rail, outcome };
  }

  // ── BBPS (Bharat BillPay / Pay2New) ───────────────────────────────────────
  if (rail === "bbps") {
    const bbps = getPartner("bbps");
    if (!bbps.status || !txn.partnerTxnId) {
      log.warn({ refId: txn.refId }, "BBPS reconcile: no status method or provider ref");
      return { found: true, refId: txn.refId, alreadyTerminal: false, status: txn.status, rail, outcome: "noop" };
    }
    const s = await bbps.status({ orderId: txn.partnerTxnId });
    if (!s.ok) {
      return { found: true, refId: txn.refId, alreadyTerminal: false, status: txn.status, rail, outcome: "noop" };
    }
    if (s.data.status === "PENDING") {
      return { found: true, refId: txn.refId, alreadyTerminal: false, status: txn.status, rail, outcome: "pending" };
    }
    const res = await finalizeServiceTransaction({
      txn,
      status: s.data.status, // SUCCESS | FAILED | REFUNDED
      partnerTxnId: txn.partnerTxnId,
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
