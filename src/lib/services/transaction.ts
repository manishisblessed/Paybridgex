import { Prisma, type ServiceCode, type TxnStatus } from "@prisma/client";
import { nanoid } from "nanoid";
import { prisma } from "../db";
import { creditWallet, debitWallet, LedgerError } from "../ledger";
import { add, sub, round, GST_RATE_PCT } from "../money";
import { assertTransactionRisk } from "../risk/engine";
import { assertAccountActive } from "../security/accountGate";
import { requireActiveScheme } from "../scheme/gate";
import { emitWebhookEvent } from "../platform/webhooks";
import { distributeCommission, distributeMdrCommission, mdrKindForService } from "../commission/distribute";
import { creditServiceMargin } from "../commission/revenue";
import { isChargeDrivenService } from "../scheme/constants";
import { friendlyPartnerError, isSensitivePartnerCode } from "../partners/friendlyError";
import { partnerCallContext } from "../partners/callContext";
import { sendOpsAlert } from "../monitoring/alerts";
import type { PartnerResult } from "../partners/types";

/**
 * Wraps every external partner call inside our DB ledger so we get:
 *   - Idempotency (duplicate clicks are safe)
 *   - Audit trail (request + response JSON for reconciliation)
 *   - Atomic wallet debit/credit (no orphaned money)
 *
 * Money flow follows the canonical ledger (src/lib/ledger.ts): the reserve,
 * commission and reversal are each Decimal + row-locked + idempotency-keyed
 * WalletTxn entries, so concurrent transactions on the same wallet cannot race
 * into an overspend and retries never double-apply.
 *
 * Use this for ALL money-moving services. Read-only calls (search, plans,
 * fetch bill) can hit the partner directly.
 */
/**
 * Service rails that (a) have a provider status() API and (b) are drained by a
 * reconciliation sweep — i.e. rails where an INDETERMINATE pay outcome can be
 * safely HELD (NEEDS_REVIEW) and resolved out-of-band instead of blind-refunded.
 * Kept in sync with the recon coverage in src/lib/recon/bbps.ts + rechargekit.ts.
 */
const RECON_CAPABLE_BBPS_SERVICES: ServiceCode[] = [
  "BILL_ELECTRICITY", "BILL_WATER", "BILL_GAS",
  "BILL_CREDIT_CARD", "BILL_EDUCATION", "BILL_INSURANCE",
  "RECHARGE_BROADBAND",
];

function railSupportsHoldAndRecon(partner: string, service: ServiceCode): boolean {
  if (partner === "SAMEDAY_RECHARGEKIT") return true; // RechargeKit CC-2
  return RECON_CAPABLE_BBPS_SERVICES.includes(service); // BBPS / Pay2New
}

export type RunTxnInput<TIn, TOut> = {
  userId: string;
  service: ServiceCode;
  amount: number;
  idempotencyKey: string;
  customer?: string;
  operator?: string;
  partner: string;
  request: TIn;
  ip?: string;
  device?: string;
  /** Calculate fee + commission BEFORE calling the partner. */
  fee?: number;
  commission?: number;
  /**
   * GST portion already contained inside `fee` (₹). GST is a pass-through
   * liability, so it is excluded from company revenue. Defaults to 0.
   */
  gst?: number;
  /**
   * Upstream/vendor cost the company pays for this txn (₹), locked from the
   * provider rate card. For charge-driven service rails (BBPS/Payout) the
   * company revenue = (fee − gst) − vendorCharge is credited to the Revenue
   * Wallet on success. Defaults to 0 (whole ex-GST charge is revenue).
   */
  vendorCharge?: number;
  /**
   * Per-product pricing scope (BBPS/CC ServiceRoute key, e.g. "bbps_credit_card"
   * vs "rechargekit_cc"). Snapshotted on the Transaction so revenue can be
   * reported per product even when two products share one partner. Optional.
   */
  priceScope?: string | null;
  /** The actual partner call. */
  call: () => Promise<PartnerResult<TOut>>;
};

export async function runTransaction<TIn, TOut>(
  input: RunTxnInput<TIn, TOut>
): Promise<{ status: TxnStatus; refId: string; data?: TOut; error?: string }> {
  const refId = `TXN${nanoid(10).toUpperCase()}`;

  // Per-user idempotency keys for each distinct money movement. WalletTxn keys
  // are globally unique, so scope by userId to avoid cross-user collisions when
  // two users happen to send the same client-supplied idempotencyKey.
  const baseKey = `txn:${input.userId}:${input.idempotencyKey}`;
  const reserveKey = `${baseKey}:reserve`;
  const reversalKey = `${baseKey}:reversal`;

  // Exact Decimal amounts (never JS float math on money).
  const reserveAmount = round(add(input.amount, input.fee ?? 0));
  const commissionAmount = round(input.commission ?? 0);
  const gstAmount = round(input.gst ?? 0);
  const vendorCharge = round(input.vendorCharge ?? 0);

  // 1. Idempotency — if we already reserved funds for this key, replay the
  //    original transaction instead of creating a duplicate.
  const existingReserve = await prisma.walletTxn.findUnique({
    where: { idempotencyKey: reserveKey },
  });
  if (existingReserve?.refId) {
    const existingTxn = await prisma.transaction.findUnique({
      where: { id: existingReserve.refId },
    });
    if (existingTxn) {
      return {
        status: existingTxn.status,
        refId: existingTxn.refId,
        data: existingTxn.response as TOut,
      };
    }
  }

  // 1a. Account status gate — a SUSPENDED/CLOSED account (admin or distributor
  //     action) cannot start NEW money movements. Checked fresh from the DB so
  //     a suspension bites even for sessions minted before it. Throws
  //     AccountSuspendedError (403) which routes map via toErrorResponse.
  await assertAccountActive(input.userId);

  // 1a2. Scheme gate — network users (RT/DT/MD/SD) may only move money once
  //      their parent (or admin) has assigned them an ACTIVE scheme. Throws
  //      NoSchemeError (403) which routes map via toErrorResponse.
  await requireActiveScheme(input.userId);

  // 1b. Risk rules (velocity / daily caps) — evaluated on genuinely NEW
  //     movements only (idempotent replays above are exempt). Throws RiskError
  //     (403) which routes map via toErrorResponse.
  await assertTransactionRisk({
    userId: input.userId,
    service: input.service,
    amount: reserveAmount,
    ip: input.ip,
  });

  // 2. Reserve money up front via the ledger (row-locked DEBIT).
  let txn;
  try {
    txn = await prisma.$transaction(async (tx) => {
      const created = await tx.transaction.create({
        data: {
          refId,
          userId: input.userId,
          service: input.service,
          amount: new Prisma.Decimal(round(input.amount)),
          fee: new Prisma.Decimal(round(input.fee ?? 0)),
          commission: new Prisma.Decimal(commissionAmount),
          gst: new Prisma.Decimal(gstAmount),
          // Stamp the authoritative slab rate (18 standard; 0 when no GST) so the
          // GST report groups by it instead of re-deriving from gst÷taxable.
          gstRate: gstAmount.gt(0) ? GST_RATE_PCT : 0,
          vendorCharge: new Prisma.Decimal(vendorCharge),
          priceScope: input.priceScope ?? null,
          status: "PROCESSING",
          customer: input.customer,
          operator: input.operator,
          partner: input.partner,
          request: input.request as Prisma.InputJsonValue,
          ipAddress: input.ip,
          device: input.device,
        },
      });

      await debitWallet(
        {
          userId: input.userId,
          amount: reserveAmount,
          reason: "TRANSACTION",
          refType: "Transaction",
          refId: created.id,
          idempotencyKey: reserveKey,
        },
        tx
      );

      return created;
    });
  } catch (e) {
    if (e instanceof LedgerError && e.code === "INSUFFICIENT_FUNDS") {
      return { status: "FAILED" as const, refId, error: "Insufficient wallet balance" };
    }
    throw e;
  }

  // 3. Hit the partner OUTSIDE the DB transaction.
  //
  // Run the partner call inside the async call context carrying this refId so
  // the transport (samedayRequest) can durably log every money-moving call to
  // PartnerApiLog correlated to THIS transaction. If the process dies between
  // this call returning and step 4 persisting the response, the provider's poll
  // key (request_id/order_id) survives in PartnerApiLog and recon recovers it.
  let result: PartnerResult<TOut>;
  try {
    result = await partnerCallContext.run({ txnRefId: refId }, () => input.call());
  } catch (e) {
    // An uncaught throw during the partner call is INDETERMINATE — we have no
    // answer and the provider may have acted. Never auto-refund on this.
    result = { ok: false, code: "EXCEPTION", message: (e as Error).message, indeterminate: true };
  }

  // 4a. Pending path — partner accepted but hasn't confirmed yet. Keep the
  // transaction in PROCESSING (money stays reserved); the reconciliation
  // sweep will finalize it once the provider returns a terminal state.
  if (result.ok && result.pending) {
    await prisma.transaction.update({
      where: { id: txn.id },
      data: {
        response: result.raw as Prisma.InputJsonValue,
        partnerTxnId: result.partnerTxnId,
      },
    });
    return { status: "PROCESSING" as const, refId, data: result.data };
  }

  // 4. Settle: mark SUCCESS and distribute commission up the chain, or refund.
  if (result.ok) {
    await prisma.$transaction(async (tx) => {
      await tx.transaction.update({
        where: { id: txn.id },
        data: {
          status: "SUCCESS",
          response: result.raw as Prisma.InputJsonValue,
          partnerTxnId: result.partnerTxnId,
        },
      });

      // Commission distribution: the engine only credits for PG/POS/QR
      // services. Service transactions (BBPS, Payout, etc.) return empty.
      //   - PG/POS/QR/UPI_COLLECT: MDR chain model — the company MDR margin is
      //     credited to the Revenue Wallet and upline (DT/MD/SD) commissions
      //     are paid out of it, net of 2% TDS (TDS → separate ledger). The
      //     transacting retailer earns no commission here.
      //   - everything else: legacy flat model via getEffectiveRate.
      try {
        const mdrKind = mdrKindForService(input.service);
        const credits = mdrKind
          ? await distributeMdrCommission(
              txn.id,
              input.userId,
              mdrKind,
              input.amount,
              input.service,
              {},
              tx
            )
          : await distributeCommission(
              txn.id,
              input.userId,
              input.service,
              input.amount,
              tx,
              input.partner
            );
        const own = credits.find((c) => c.userId === input.userId);
        await tx.transaction.update({
          where: { id: txn.id },
          data: { commission: new Prisma.Decimal(round(own?.amount ?? 0)) },
        });
      } catch {
        // Scheme lookup failed — commission stays uncredited;
        // the recon sweep / support can replay distribution idempotently.
      }

      // Charge-driven service rails (BBPS/Payout) pay no chain commission, so
      // the company's booked earning is the spread: (fee − GST) − vendor cost.
      // Credit it to the Revenue Wallet (idempotent, best-effort inside tx).
      if (isChargeDrivenService(input.service)) {
        const margin = round(sub(sub(input.fee ?? 0, gstAmount), vendorCharge));
        await creditServiceMargin(txn.id, input.service, margin, tx);
      }

      await tx.auditLog.create({
        data: {
          userId: input.userId,
          action: "txn.success",
          entity: "Transaction",
          entityId: txn.id,
          meta: { refId, partner: input.partner },
        },
      });
    });
    // Partner webhook (best-effort; never blocks settlement).
    void emitWebhookEvent(input.userId, "txn.success", {
      refId,
      service: input.service,
      amount: input.amount,
      customer: input.customer ?? null,
      operator: input.operator ?? null,
    });
    return { status: "SUCCESS", refId, data: result.data };
  }

  // 4b. INDETERMINATE path — a transport/gateway failure (NETWORK / HTTP 5xx /
  // timeout / exception) where we got NO definitive answer and the provider MAY
  // have charged. For rails we can reconcile (BBPS/Pay2New, RechargeKit CC-2) we
  // HOLD the reserve (NO refund) and park the txn in NEEDS_REVIEW. The provider
  // status API / recon sweep / admin resolver settles or refunds it once the
  // authoritative outcome is known — so a payment that actually succeeded is
  // never wrongly refunded (the exact direct-loss bug this prevents).
  if (!result.ok && result.indeterminate && railSupportsHoldAndRecon(input.partner, input.service)) {
    await prisma.transaction.update({
      where: { id: txn.id },
      data: {
        status: "NEEDS_REVIEW",
        errorCode: result.code,
        errorMessage:
          "Payment is being verified with the provider. Your funds are safe and held until it is confirmed — no action needed.",
        response: (result.raw ?? null) as Prisma.InputJsonValue,
      },
    });
    void sendOpsAlert({
      title: "Indeterminate payment HELD for review (funds NOT refunded)",
      severity: "critical",
      details: {
        refId,
        service: input.service,
        partner: input.partner,
        code: result.code ?? null,
        amount: input.amount,
      },
    });
    await prisma.auditLog.create({
      data: {
        userId: input.userId,
        action: "txn.held_for_review",
        entity: "Transaction",
        entityId: txn.id,
        meta: { refId, code: result.code, reason: "indeterminate_partner_result" },
      },
    });
    return { status: "NEEDS_REVIEW" as const, refId, error: "Payment under verification" };
  }

  // Failure path — refund the reserved money via the ledger (REVERSAL credit).
  //
  // The user only ever sees a sanitized, friendly message; the RAW partner
  // code + full response JSON stay on the row (and in the audit log) for
  // support and reconciliation. A "sensitive" code (e.g. INSUFFICIENT_BALANCE
  // = our Same Day float is low, NOT the retailer's wallet) is never exposed —
  // instead we page ops so the real cause gets fixed.
  const userMessage = friendlyPartnerError(result.code, result.message, "payment");
  if (isSensitivePartnerCode(result.code)) {
    void sendOpsAlert({
      title: "Partner rejected a transaction for an internal reason",
      severity: "critical",
      details: {
        refId,
        service: input.service,
        partner: input.partner,
        code: result.code ?? null,
        amount: input.amount,
      },
    });
  }
  await prisma.$transaction(async (tx) => {
    await tx.transaction.update({
      where: { id: txn.id },
      data: {
        status: "FAILED",
        errorCode: result.code,
        errorMessage: userMessage,
        response: (result.raw ?? null) as Prisma.InputJsonValue,
      },
    });
    await creditWallet(
      {
        userId: input.userId,
        amount: reserveAmount,
        reason: "REVERSAL",
        refType: "Transaction",
        refId: txn.id,
        idempotencyKey: reversalKey,
      },
      tx
    );
    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: "txn.failed",
        entity: "Transaction",
        entityId: txn.id,
        meta: { refId, code: result.code, message: result.message },
      },
    });
  });

  // Partner webhook (best-effort).
  void emitWebhookEvent(input.userId, "txn.failed", {
    refId,
    service: input.service,
    amount: input.amount,
    code: result.code ?? null,
    message: result.message ?? null,
  });

  return { status: "FAILED", refId, error: userMessage };
}
