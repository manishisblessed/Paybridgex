import { Prisma, type ServiceCode, type TxnStatus } from "@prisma/client";
import { nanoid } from "nanoid";
import { prisma } from "../db";
import { creditWallet, debitWallet, LedgerError } from "../ledger";
import { add, sub, round } from "../money";
import { assertTransactionRisk } from "../risk/engine";
import { assertAccountActive } from "../security/accountGate";
import { requireActiveScheme } from "../scheme/gate";
import { emitWebhookEvent } from "../platform/webhooks";
import { distributeCommission, distributeMdrCommission, mdrKindForService } from "../commission/distribute";
import { creditServiceMargin } from "../commission/revenue";
import { isChargeDrivenService } from "../scheme/constants";
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
  let result: PartnerResult<TOut>;
  try {
    result = await input.call();
  } catch (e) {
    result = { ok: false, code: "EXCEPTION", message: (e as Error).message };
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

  // Failure path — refund the reserved money via the ledger (REVERSAL credit).
  await prisma.$transaction(async (tx) => {
    await tx.transaction.update({
      where: { id: txn.id },
      data: {
        status: "FAILED",
        errorCode: result.code,
        errorMessage: result.message,
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

  return { status: "FAILED", refId, error: result.message };
}
