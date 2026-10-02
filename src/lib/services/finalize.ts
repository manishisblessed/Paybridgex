import { Prisma, type ServiceCode, type TxnStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { creditWallet, placeLienHold } from "@/lib/ledger";
import { creditServiceMargin } from "@/lib/commission/revenue";
import { isChargeDrivenService } from "@/lib/scheme/constants";
import { emitWebhookEvent } from "@/lib/platform/webhooks";
import { friendlyPartnerError } from "@/lib/partners/friendlyError";
import { add, sub, round, dec } from "@/lib/money";
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

// A held NEEDS_REVIEW txn is non-terminal: the out-of-band finalizer may still
// settle (SUCCESS) or refund (FAILED/REFUNDED) it once the provider's
// authoritative outcome is known.
const NON_TERMINAL: TxnStatus[] = ["INITIATED", "PROCESSING", "NEEDS_REVIEW"];

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

/**
 * CORRECTIVE finalizer: promote an already-TERMINAL FAILED/REFUNDED transaction
 * to SUCCESS after the provider's authoritative outcome proves the money DID
 * move — the direct-financial-loss case this whole subsystem exists to prevent.
 *
 * The ordinary {@link finalizeServiceTransaction} deliberately only acts on
 * non-terminal rows, so it can NEVER touch a row that was wrongly refunded. This
 * function is the single, audited, admin-triggered path that can, and it does so
 * safely:
 *
 *   1. At-most-once — the status claim is scoped to `FAILED | REFUNDED`; a second
 *      run (or a race) sees SUCCESS and becomes a no-op, so the clawback and the
 *      margin can each happen at most once.
 *   2. Clawback WITHOUT a negative wallet — if (and only if) the retailer was
 *      actually refunded earlier (detected via the deterministic REVERSAL key),
 *      the refunded reserve is recovered through a LIEN: it sweeps whatever is
 *      available now and recovers the rest EAGERLY from every future credit. The
 *      wallet is never driven negative.
 *   3. A held NEEDS_REVIEW row was never refunded, so it must NOT come through
 *      here — it settles via the ordinary finalizer (no clawback needed).
 *
 * Returns what actually happened so the caller can report it to the admin.
 */
export async function correctTerminalToSuccess(opts: {
  txn: FinalizableTxn;
  partnerTxnId?: string | null;
  raw?: unknown;
  /** Admin (or system actor) responsible — recorded on the lien + audit log. */
  actorId: string;
  /** Provenance, e.g. "admin_resolve" | "corrective_recon". */
  source: string;
  remarks?: string;
}): Promise<{
  corrected: boolean;
  clawbackPlaced: boolean;
  lienId: string | null;
  refunded: number;
}> {
  const { txn, actorId, source } = opts;
  const partnerTxnId = opts.partnerTxnId ?? txn.partnerTxnId ?? null;
  const raw = (opts.raw ?? null) as Prisma.InputJsonValue;
  const reserveAmount = round(add(txn.amount.toNumber(), txn.fee.toNumber()));

  let corrected = false;
  let clawbackPlaced = false;
  let lienId: string | null = null;
  let refunded = 0;

  await prisma.$transaction(async (tx) => {
    // Claim ONLY a genuinely terminal-failed row → SUCCESS. At-most-once.
    const claim = await tx.transaction.updateMany({
      where: { id: txn.id, status: { in: ["FAILED", "REFUNDED"] } },
      data: { status: "SUCCESS", partnerTxnId, errorCode: null, errorMessage: null, response: raw },
    });
    if (claim.count === 0) return; // already corrected / not a terminal-failed row
    corrected = true;

    // Only claw back money that was ACTUALLY returned. The refund (if any) was a
    // REVERSAL credit written under this deterministic key.
    const reversal = await tx.walletTxn.findUnique({
      where: { idempotencyKey: `txn:${txn.userId}:${txn.refId}:reversal` },
      select: { amount: true },
    });
    if (reversal) {
      refunded = reversal.amount.toNumber();
      // LIEN-based recovery → sweeps available funds now, recovers the rest from
      // future credits; floored at zero so the wallet never goes negative.
      const lien = await tx.walletLien.create({
        data: {
          targetUserId: txn.userId,
          actorId,
          amount: dec(refunded),
          reasonCode: "OTHER",
          remarks:
            opts.remarks?.trim() ||
            `Corrective clawback — provider-confirmed SUCCESS on wrongly-refunded txn ${txn.refId}`,
          refType: "Transaction",
          refId: txn.id,
          status: "ACTIVE",
        },
      });
      lienId = lien.id;
      await placeLienHold(txn.userId, refunded, tx);
      clawbackPlaced = true;
    }

    // Book the company margin exactly like a normal SUCCESS settlement.
    if (isChargeDrivenService(txn.service)) {
      const margin = round(
        sub(sub(txn.fee.toNumber(), txn.gst.toNumber()), txn.vendorCharge.toNumber())
      );
      await creditServiceMargin(txn.id, txn.service, margin, tx);
    }

    await tx.auditLog.create({
      data: {
        userId: txn.userId,
        action: "txn.corrected_to_success",
        entity: "Transaction",
        entityId: txn.id,
        meta: {
          refId: txn.refId,
          source,
          actorId,
          reserveAmount,
          refunded,
          clawbackPlaced,
          lienId,
          partner: txn.partner,
        },
      },
    });
  });

  if (corrected) {
    void emitWebhookEvent(txn.userId, "txn.success", {
      refId: txn.refId,
      service: txn.service,
      amount: txn.amount.toNumber(),
    });
    log.info(
      { refId: txn.refId, source, clawbackPlaced, refunded },
      "terminal txn corrected to SUCCESS"
    );
  }
  return { corrected, clawbackPlaced, lienId, refunded };
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
