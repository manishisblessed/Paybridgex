import { Prisma, type ServiceCode, type TxnStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { creditWallet, placeLienHold } from "@/lib/ledger";
import { creditServiceMargin } from "@/lib/commission/revenue";
import { isChargeDrivenService } from "@/lib/scheme/constants";
import { emitWebhookEvent } from "@/lib/platform/webhooks";
import { friendlyPartnerError } from "@/lib/partners/friendlyError";
import { add, sub, round, dec } from "@/lib/money";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

const log = logger.child({ module: "services/finalize" });

/** Deferred-refund cooling-off window (ms). Env-tunable; defaults to 30 min. */
function refundHoldMs(): number {
  return Math.max(0, env.REFUND_HOLD_MINUTES) * 60_000;
}

/**
 * True when a write failed because it would create a SECOND SUCCESS row on the
 * same provider order — the partial unique index `transaction_partner_txn_success_uq`
 * (one SUCCESS per non-null partnerTxnId). This is the race-proof backstop
 * behind the application-level pre-check: when two finalizers settle the same
 * upstream order concurrently, exactly one wins and the loser lands here.
 */
export function isPartnerTxnDuplicate(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return false;
  const t = e.meta?.target;
  const s = Array.isArray(t) ? t.join(",") : String(t ?? "");
  return s.includes("partner_txn") || s.includes("partnerTxnId");
}

// These finalizers run claim + ledger movements (which may trigger a lien sweep
// touching several rows) in ONE interactive transaction. Prisma's 5s default is
// too tight over a high-latency DB link (EC2 ↔ allow-listed Postgres), so give
// the whole unit generous headroom — it's still a small, bounded amount of work.
const TXN_OPTS = { timeout: 30_000, maxWait: 15_000 } as const;

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
  /**
   * Bypass the deferred-refund cooling-off window and release the reserve NOW.
   * Reserved for provably-safe or operator-authorized refunds (duplicate-leg
   * phantom reversal, admin force-refund after manual verification). Never set
   * by the ordinary webhook / recon / status-poll finalizers — those MUST go
   * through the double-checked 30-min hold.
   */
  immediate?: boolean;
}): Promise<{ finalized: boolean; outcome: FinalizeOutcome }> {
  const { txn, status, source } = opts;
  const partnerTxnId = opts.partnerTxnId ?? txn.partnerTxnId ?? null;
  const raw = (opts.raw ?? null) as Prisma.InputJsonValue;

  // ── SUCCESS ─────────────────────────────────────────────────────────────
  if (status === "SUCCESS") {
    // ── Duplicate-order backstop ──────────────────────────────────────────
    // At most ONE Transaction may settle SUCCESS per provider order. The
    // upstream provider returns the same order id for a rapid same-card re-tap,
    // so two internal rows can both resolve to a single real payment. If
    // another row already owns this partnerTxnId as SUCCESS, THIS row is a
    // phantom duplicate — refund its held reserve (amount + fee) instead of
    // charging the retailer twice. (Fast-path pre-check; the partial unique
    // index + the P2002 catch below make it race-proof.)
    if (partnerTxnId) {
      const dup = await prisma.transaction.findFirst({
        where: { partnerTxnId, status: "SUCCESS", id: { not: txn.id } },
        select: { refId: true },
      });
      if (dup) {
        log.warn(
          { refId: txn.refId, partnerTxnId, duplicateOf: dup.refId, source },
          "duplicate provider order on settle — refunding phantom leg instead of double-charging"
        );
        return finalizeServiceTransaction({
          txn,
          status: "REFUNDED",
          partnerTxnId,
          errorCode: "DUPLICATE_PARTNER_TXN",
          errorMessage: `Duplicate of ${dup.refId} on provider order ${partnerTxnId}`,
          raw: opts.raw,
          source: `${source}_dup`,
          // Provably safe: the real money is accounted under the other SUCCESS
          // leg, so this phantom reserve is released immediately (no cooling-off).
          immediate: true,
        });
      }
    }

    let finalized = false;
    try {
      await prisma.$transaction(async (tx) => {
        const claim = await tx.transaction.updateMany({
          where: { id: txn.id, status: { in: NON_TERMINAL } },
          // Clear any pending refund schedule: the provider confirmed the money
          // DID move, so a refund must never fire for this row.
          data: { status: "SUCCESS", partnerTxnId, response: raw, refundEligibleAt: null },
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
      }, TXN_OPTS);
    } catch (e) {
      // Race backstop: a concurrent finalizer settled the SAME provider order
      // first and the partial unique index rejected our second SUCCESS. Refund
      // this phantom leg instead of surfacing a hard error or double-charging.
      if (isPartnerTxnDuplicate(e) && partnerTxnId) {
        log.warn(
          { refId: txn.refId, partnerTxnId, source },
          "duplicate provider order race on settle — refunding phantom leg"
        );
        return finalizeServiceTransaction({
          txn,
          status: "REFUNDED",
          partnerTxnId,
          errorCode: "DUPLICATE_PARTNER_TXN",
          errorMessage: `Duplicate provider order ${partnerTxnId}`,
          raw: opts.raw,
          source: `${source}_dup`,
          // Provably safe duplicate (another leg owns the order) → immediate.
          immediate: true,
        });
      }
      throw e;
    }

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

  // ── FAILED / REFUNDED — DEFERRED, DOUBLE-CHECKED refund of the reserve ─────
  // CRITICAL: on the SameDay rails a provider "failure" can arrive while the
  // payment was ACTUALLY charged (a card-push decline that SameDay reverses to
  // our float only later). So we NEVER release the retailer's reserve on the
  // first failure signal. The lifecycle is:
  //   1. first confirmed failure → stamp refundEligibleAt = now + REFUND_HOLD,
  //      keep the row HELD (NEEDS_REVIEW), move NO money.
  //   2. still inside the window  → wait (the 5-min recon sweep revisits).
  //   3. window elapsed AND the caller's fresh provider re-poll STILL reports
  //      FAILED/REFUNDED (the double-check — every out-of-band finalizer re-polls
  //      the status API before calling us) → mark terminal + credit the reserve.
  // Idempotent throughout: a pre-existing REVERSAL short-circuits to terminal.
  const reserveAmount = round(add(txn.amount.toNumber(), txn.fee.toNumber()));
  const terminal: TxnStatus = status === "REFUNDED" ? "REFUNDED" : "FAILED";
  const immediate = opts.immediate === true;

  // ── Refund-not-previously-done guard ──────────────────────────────────────
  // If the reserve was ever credited back for this txn, NEVER credit again —
  // just ensure the row is terminal and return a no-op.
  const priorReversal = await prisma.walletTxn.findFirst({
    where: {
      userId: txn.userId,
      direction: "CREDIT",
      reason: "REVERSAL",
      refType: "Transaction",
      refId: txn.id,
    },
    select: { id: true },
  });
  if (priorReversal) {
    await prisma.transaction.updateMany({
      where: { id: txn.id, status: { in: NON_TERMINAL } },
      data: { status: terminal, partnerTxnId, refundedAt: new Date(), refundEligibleAt: null },
    });
    return { finalized: false, outcome: "noop" };
  }

  // ── Cooling-off gate (skipped only for immediate/duplicate/admin refunds) ──
  if (!immediate) {
    const current = await prisma.transaction.findUnique({
      where: { id: txn.id },
      select: { status: true, refundEligibleAt: true },
    });
    if (!current || !NON_TERMINAL.includes(current.status)) {
      return { finalized: false, outcome: "noop" }; // already terminal / gone
    }
    const now = Date.now();
    if (!current.refundEligibleAt) {
      // First confirmed failure → schedule the refund and HOLD the reserve.
      const eligibleAt = new Date(now + refundHoldMs());
      const scheduled = await prisma.transaction.updateMany({
        where: { id: txn.id, status: { in: NON_TERMINAL }, refundEligibleAt: null },
        data: {
          status: "NEEDS_REVIEW",
          refundEligibleAt: eligibleAt,
          partnerTxnId,
          errorCode: opts.errorCode ?? `PROVIDER_${status}`,
          errorMessage:
            "Payment failed at the provider and is being verified with SameDay before any refund. Your funds are safe and held until it is confirmed — no action needed.",
          response: raw,
        },
      });
      if (scheduled.count > 0) {
        await prisma.auditLog.create({
          data: {
            userId: txn.userId,
            action: `txn.${source}_refund_scheduled`,
            entity: "Transaction",
            entityId: txn.id,
            meta: {
              refId: txn.refId,
              source,
              providerStatus: status,
              eligibleAt: eligibleAt.toISOString(),
              holdMinutes: Math.round(refundHoldMs() / 60_000),
              partner: txn.partner,
            },
          },
        });
        log.info(
          { refId: txn.refId, source, eligibleAt: eligibleAt.toISOString() },
          "refund scheduled — reserve HELD pending double-check"
        );
      }
      return { finalized: false, outcome: "noop" };
    }
    if (current.refundEligibleAt.getTime() > now) {
      // Still cooling off — the next sweep re-poll (after the window) releases it.
      return { finalized: false, outcome: "noop" };
    }
    // Window elapsed AND this caller just re-polled the provider → this call IS
    // the double-check. Fall through and release the reserve.
  }

  let finalized = false;
  await prisma.$transaction(async (tx) => {
    const claim = await tx.transaction.updateMany({
      where: { id: txn.id, status: { in: NON_TERMINAL } },
      data: {
        status: terminal,
        partnerTxnId,
        refundedAt: new Date(),
        refundEligibleAt: null,
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
  }, TXN_OPTS);

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
      data: { status: "SUCCESS", partnerTxnId, errorCode: null, errorMessage: null, response: raw, refundEligibleAt: null },
    });
    if (claim.count === 0) return; // already corrected / not a terminal-failed row
    corrected = true;

    // Only claw back money that was ACTUALLY returned. Detect the refund via the
    // DURABLE ledger link — a REVERSAL credit pointing at this Transaction —
    // rather than a single deterministic key: rows failed by older code refunded
    // under different (or no) idempotency keys, and missing that refund here would
    // hand the retailer free money when we promote the row to SUCCESS. Summing is
    // safe (a normal txn has exactly one reversal) and still bounded by the
    // at-most-once status claim above.
    const reversalAgg = await tx.walletTxn.aggregate({
      where: {
        userId: txn.userId,
        direction: "CREDIT",
        reason: "REVERSAL",
        refType: "Transaction",
        refId: txn.id,
      },
      _sum: { amount: true },
    });
    const refundedAmt = reversalAgg._sum.amount?.toNumber() ?? 0;
    if (refundedAmt > 0) {
      refunded = refundedAmt;
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
      // Governance: notify the retailer their earlier refund is being clawed back
      // (the provider confirmed the payment actually succeeded). Atomic with the lien.
      await tx.notification.create({
        data: {
          userId: txn.userId,
          title: "A wallet hold was placed to recover a refund",
          body: `₹${refunded.toFixed(2)} from txn ${txn.refId} is being recovered: the provider confirmed this payment actually succeeded, so the earlier refund is reversed via a recovery hold (not a negative balance).`,
          channel: "INAPP",
          href: "/dashboard/wallet",
        },
      });
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
  }, TXN_OPTS);

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
