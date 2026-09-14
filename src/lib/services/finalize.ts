import { Prisma, type ServiceCode, type TxnStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { creditWallet } from "@/lib/ledger";
import { creditServiceMargin } from "@/lib/commission/revenue";
import { isChargeDrivenService } from "@/lib/scheme/constants";
import { emitWebhookEvent } from "@/lib/platform/webhooks";
import { friendlyPartnerError } from "@/lib/partners/friendlyError";
import { add, sub, round } from "@/lib/money";
import { logger } from "@/lib/logger";

const log = logger.child({ module: "services/finalize" });

/**
 * Provider-agnostic terminal finalizer for a service `Transaction` left in a
 * non-terminal state (INITIATED/PROCESSING).
 *
 * This is the SINGLE settle/refund path shared by every out-of-band finalizer
 * (the inbound Same Day webhook and the reconciliation sweeps) so a transaction
 * finishes exactly the same way no matter which trigger fires first:
 *
 *   SUCCESS            → mark SUCCESS, book the company margin for charge-driven
 *                        rails (BBPS/RechargeKit/Payout), emit `txn.success`.
 *   FAILED | REFUNDED  → mark the terminal status and REVERSAL-credit the held
 *                        reserve (amount + fee) back to the wallet, emit
 *                        `txn.failed`.
 *
 * At-most-once is guaranteed by a conditional status claim (`updateMany` scoped
 * to INITIATED/PROCESSING): whoever transitions the row first wins; every later
 * caller (retry, racing webhook + sweep) is a no-op. The ledger writes are
 * additionally idempotency-keyed, so even a replay inside the winning branch
 * cannot double-credit.
 */
export type FinalizableTxn = {
  id: string;
  refId: string;
  userId: string;
  amount: Prisma.Decimal;
  fee: Prisma.Decimal;
  gst: Prisma.Decimal;
  vendorCharge: Prisma.Decimal;
  service: ServiceCode;
  status: TxnStatus;
  partner: string | null;
  partnerTxnId: string | null;
};

const NON_TERMINAL: TxnStatus[] = ["INITIATED", "PROCESSING"];

export type FinalizeOutcome = "settled" | "refunded" | "noop";

export async function finalizeServiceTransaction(opts: {
  txn: FinalizableTxn;
  status: "SUCCESS" | "FAILED" | "REFUNDED";
  partnerTxnId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  raw?: unknown;
  /** Provenance for the audit trail, e.g. "webhook" | "recon". */
  source: string;
}): Promise<{ finalized: boolean; outcome: FinalizeOutcome }> {
  const { txn, status, source } = opts;
  const partnerTxnId = opts.partnerTxnId ?? txn.partnerTxnId ?? null;
  const raw = (opts.raw ?? null) as Prisma.InputJsonValue;

  // ── SUCCESS ─────────────────────────────────────────────────────────────
  if (status === "SUCCESS") {
    let finalized = false;
    await prisma.$transaction(async (tx) => {
      const claim = await tx.transaction.updateMany({
        where: { id: txn.id, status: { in: NON_TERMINAL } },
        data: { status: "SUCCESS", partnerTxnId, response: raw },
      });
      if (claim.count === 0) return; // someone finalized first
      finalized = true;

      // Charge-driven rails (BBPS/RechargeKit/Payout) book the spread —
      // (fee − gst) − vendorCharge — into the Revenue Wallet. Idempotent.
      if (isChargeDrivenService(txn.service)) {
        const margin = round(
          sub(sub(txn.fee.toNumber(), txn.gst.toNumber()), txn.vendorCharge.toNumber())
        );
        await creditServiceMargin(txn.id, txn.service, margin, tx);
      }

      await tx.auditLog.create({
        data: {
          userId: txn.userId,
          action: `txn.${source}_settled`,
          entity: "Transaction",
          entityId: txn.id,
          meta: { refId: txn.refId, source, partner: txn.partner },
        },
      });
    });

    if (finalized) {
      void emitWebhookEvent(txn.userId, "txn.success", {
        refId: txn.refId,
        service: txn.service,
        amount: txn.amount.toNumber(),
      });
      log.info({ refId: txn.refId, source }, "service txn settled via out-of-band finalizer");
    }
    return { finalized, outcome: finalized ? "settled" : "noop" };
  }

  // ── FAILED / REFUNDED — refund the held reserve (amount + fee) ────────────
  const reserveAmount = round(add(txn.amount.toNumber(), txn.fee.toNumber()));
  const terminal: TxnStatus = status === "REFUNDED" ? "REFUNDED" : "FAILED";
  let finalized = false;
  await prisma.$transaction(async (tx) => {
    const claim = await tx.transaction.updateMany({
      where: { id: txn.id, status: { in: NON_TERMINAL } },
      data: {
        status: terminal,
        partnerTxnId,
        errorCode: opts.errorCode ?? `PROVIDER_${status}`,
        // Never persist raw provider text on the user-visible field — the full
        // payload is kept in `response` for support/recon.
        errorMessage: opts.errorMessage
          ? friendlyPartnerError(opts.errorCode, opts.errorMessage, "payment")
          : `Provider reported ${status} for ${txn.refId}`,
        response: raw,
      },
    });
    if (claim.count === 0) return;
    finalized = true;

    await creditWallet(
      {
        userId: txn.userId,
        amount: reserveAmount,
        reason: "REVERSAL",
        refType: "Transaction",
        refId: txn.id,
        // Stable per-transaction key: a replay is a ledger no-op, and the status
        // claim above already prevents a second branch from ever reaching here.
        idempotencyKey: `txn:${txn.userId}:${txn.refId}:reversal`,
      },
      tx
    );

    await tx.auditLog.create({
      data: {
        userId: txn.userId,
        action: `txn.${source}_refunded`,
        entity: "Transaction",
        entityId: txn.id,
        meta: { refId: txn.refId, source, providerStatus: status, partner: txn.partner },
      },
    });
  });

  if (finalized) {
    void emitWebhookEvent(txn.userId, "txn.failed", {
      refId: txn.refId,
      service: txn.service,
      amount: txn.amount.toNumber(),
      code: opts.errorCode ?? `PROVIDER_${status}`,
      message: opts.errorMessage ?? `Transaction ${status.toLowerCase()} at provider`,
    });
    log.info({ refId: txn.refId, source, status }, "service txn refunded via out-of-band finalizer");
  }
  return { finalized, outcome: finalized ? "refunded" : "noop" };
}

/** Column set required by {@link finalizeServiceTransaction}. */
export const FINALIZABLE_TXN_SELECT = {
  id: true,
  refId: true,
  userId: true,
  amount: true,
  fee: true,
  gst: true,
  vendorCharge: true,
  service: true,
  status: true,
  partner: true,
  partnerTxnId: true,
} satisfies Prisma.TransactionSelect;
