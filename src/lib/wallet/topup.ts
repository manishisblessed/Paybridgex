/**
 * Wallet top-up via the UPI/PG partner (Chagans Comet/Star, Razorpay, or mock
 * fallback — whatever resolveUpiSelection() resolves for the chosen channel).
 *
 * Lifecycle:
 *   initiateTopup  → Transaction(WALLET_TOPUP, INITIATED) + provider collect
 *                    (refId = our Transaction.refId — alphanumeric only)
 *   settleTopup    → for PG-MDR rails (Chagans): instant T0 credit via
 *                    handleTopupCapture, driven by the webhook handler; for
 *                    standard rails (Razorpay): status poll + full-credit path.
 *                    Idempotent on both paths.
 */
import { customAlphabet } from "nanoid";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { creditWallet, schedulePosRentalRetryIfNeeded } from "../ledger";
import {
  resolveUpiSelection,
  getUpiProviderByName,
  assertRealMoneyProvider,
} from "../partners";
import { friendlyPartnerError } from "../partners/friendlyError";
import { round, dec } from "../money";
import { emitWebhookEvent } from "../platform/webhooks";
import { assertPushWithinCap, WalletOpError } from "./operations";
import { handleTopupCapture } from "../settlement/pg";
import { priceSchemeSettlement } from "../settlement/engine";
import { sendOpsAlert } from "../monitoring/alerts";

// ── ref-id generator ─────────────────────────────────────────────────────────
// Chagans rejects txnIds that contain "_" or "-". Use only A-Z0-9.
const refToken = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 12);

// ── PG-MDR provider set ───────────────────────────────────────────────────────
// Providers that go through MDR pricing at settlement time (net-of-fee credit).
// Full-credit top-ups (Razorpay, legacy rails) are NOT in this set.
export const PG_MDR_PROVIDERS = new Set(["CHAGANS_PG"]);

export function isPgMdrProvider(partnerName?: string | null): boolean {
  return PG_MDR_PROVIDERS.has((partnerName ?? "").toUpperCase());
}

/** Derive the MDR scopeKey stored on the Transaction so settle can reprice. */
export function pgScopeForTxn(partnerName: string): string {
  return partnerName.toUpperCase(); // e.g. "CHAGANS_PG"
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type TopupState = "INITIATED" | "PROCESSING" | "HOLD" | "SUCCESS" | "FAILED";

export class TopupError extends Error {
  public statusCode: number;
  constructor(message: string, statusCode = 400, public code = "TOPUP_ERROR") {
    super(message);
    this.name = "TopupError";
    this.statusCode = statusCode;
  }
}

/**
 * Webhook-supplied, gateway-verified payment outcome.  Passed as the second
 * arg to settleTopup() by the chagans-pg webhook route — bypasses the normal
 * status-poll path because Chagans has no status API.
 */
export type VerifiedPayin = {
  status: "PAID" | "FAILED" | "EXPIRED";
  amount: number;
  reference?: string;
  paymentMode?: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * True when the webhook-confirmed amount differs from our initiated amount by
 * more than 1 rupee.  If there's a mismatch we park the transaction in HOLD
 * and alert ops rather than crediting an unverified amount.
 */
function isAmountMismatch(initiated: Prisma.Decimal, confirmed: number): boolean {
  const diff = Math.abs(Number(initiated) - confirmed);
  return diff > 1.0;
}

// ── initiateTopup ─────────────────────────────────────────────────────────────

export async function initiateTopup(input: {
  userId: string;
  amount: number;
  vpa?: string;
  note?: string;
  customerPhone: string;
  customerEmail?: string;
  customerName?: string;
  ip?: string;
  /** Channel id in "<provider>:<gateway>" format, e.g. "chagans:comet". */
  channel?: string;
}): Promise<{
  refId: string;
  orderId: string;
  paymentUrl?: string;
  upiIntent?: string;
  provider: string;
  net?: number;
  mdr?: number;
}> {
  // Wallet cap gate — refuse up front.
  try {
    await assertPushWithinCap(input.userId, "PRIMARY", input.amount);
  } catch (e) {
    if (e instanceof WalletOpError) throw new TopupError(e.message, 400, e.code);
    throw e;
  }

  const sel = resolveUpiSelection(input.channel);
  const upi = sel.provider;

  assertRealMoneyProvider(
    upi,
    () =>
      new TopupError(
        "Wallet top-up is temporarily unavailable. Please try again later.",
        503,
        "PG_NOT_LIVE"
      )
  );

  // Gateway cap guard.
  if (sel.maxAmount !== undefined && input.amount > sel.maxAmount) {
    throw new TopupError(
      `Amount exceeds the maximum allowed (₹${sel.maxAmount}) for this gateway.`,
      400,
      "AMOUNT_TOO_HIGH"
    );
  }

  // Pre-flight MDR probe for PG-MDR rails (shows the retailer their net credit).
  let mdrPreview: number | undefined;
  let netPreview: number | undefined;
  if (isPgMdrProvider(upi.name)) {
    const probe = await priceSchemeSettlement({
      userId: input.userId,
      serviceKind: "PG",
      grossAmount: input.amount,
      scopeKey: pgScopeForTxn(upi.name),
      settlementType: "T0",
      anyPaymentMode: true,
    });
    if (probe) {
      mdrPreview = Number(probe.mdrAmount);
      netPreview = Number(probe.netAmount);
    }
  }

  // Apply amount uniquification if the gateway requires it.
  const collectAmount = sel.prepareAmount(input.amount);
  const refId = `TOPUP${refToken()}`;

  const txn = await prisma.transaction.create({
    data: {
      refId,
      userId: input.userId,
      service: "WALLET_TOPUP",
      amount: new Prisma.Decimal(round(input.amount)),
      status: "INITIATED",
      customer: input.customerPhone,
      partner: upi.name,
      request: {
        amount: input.amount,
        collectAmount,
        channel: input.channel ?? null,
        vpa: input.vpa ?? null,
        note: input.note ?? null,
        mdrPreview: mdrPreview ?? null,
        netPreview: netPreview ?? null,
      } as Prisma.InputJsonValue,
      ipAddress: input.ip,
    },
  });

  const r = await upi.collect({
    userId: input.userId,
    idempotencyKey: refId,
    amount: collectAmount,
    vpa: input.vpa,
    note: input.note ?? "Wallet top-up",
    customerPhone: input.customerPhone,
    customerEmail: input.customerEmail,
    customerName: input.customerName,
    callbackUrl: `${process.env.NEXT_PUBLIC_APP_URL}/pay/return?ref=${refId}`,
  });

  if (!r.ok) {
    const friendly = friendlyPartnerError(r.code, r.message, "generic");
    await prisma.transaction.update({
      where: { id: txn.id },
      data: { status: "FAILED", errorCode: r.code, errorMessage: friendly },
    });
    throw new TopupError(friendly, 502, r.code);
  }

  await prisma.transaction.update({
    where: { id: txn.id },
    data: {
      status: "PROCESSING",
      partnerTxnId: r.data.orderId,
      response: {
        paymentUrl: r.data.paymentUrl ?? null,
        upiIntent: r.data.upiIntent ?? null,
        orderId: r.data.orderId,
      } as Prisma.InputJsonValue,
    },
  });

  return {
    refId,
    orderId: r.data.orderId,
    paymentUrl: r.data.paymentUrl,
    upiIntent: r.data.upiIntent,
    provider: upi.name,
    mdr: mdrPreview,
    net: netPreview,
  };
}

// ── settleTopup ───────────────────────────────────────────────────────────────

/**
 * Settle a wallet top-up.
 *
 * For PG-MDR rails (Chagans): `webhookVerified` MUST be supplied.  We never
 * poll status on webhook-only providers.  The webhook handler resolves the
 * transaction by `orderId` (Chagans' `partnerTxnId`) and calls us with the
 * verified outcome.
 *
 * For standard rails (Razorpay): poll status and full-credit the wallet.
 */
export async function settleTopup(
  refId: string,
  webhookVerified?: VerifiedPayin,
): Promise<{ refId: string; status: TopupState; amount?: number; net?: number }> {
  const txn = await prisma.transaction.findUnique({ where: { refId } });
  if (!txn || txn.service !== "WALLET_TOPUP") {
    throw new TopupError("Top-up not found", 404, "NOT_FOUND");
  }
  if (txn.status === "SUCCESS") return { refId, status: "SUCCESS" };
  if (txn.status === "FAILED") return { refId, status: "FAILED" };
  if (txn.status === "HOLD")   return { refId, status: "HOLD" };

  // ── PG-MDR (Chagans webhook) path ──────────────────────────────────────────
  if (isPgMdrProvider(txn.partner)) {
    if (!webhookVerified) {
      // Called without a verified outcome — just return current state.
      return { refId, status: txn.status as TopupState };
    }

    if (webhookVerified.status === "FAILED" || webhookVerified.status === "EXPIRED") {
      await prisma.transaction.updateMany({
        where: { id: txn.id, status: { in: ["INITIATED", "PROCESSING"] } },
        data: { status: "FAILED", errorCode: webhookVerified.status },
      });
      return { refId, status: "FAILED" };
    }

    // PAID — amount mismatch guard (never auto-credit a different amount).
    if (isAmountMismatch(txn.amount, webhookVerified.amount)) {
      await prisma.transaction.updateMany({
        where: { id: txn.id, status: { in: ["INITIATED", "PROCESSING"] } },
        data: {
          status: "HOLD",
          errorMessage: `Amount mismatch: initiated ₹${txn.amount} but webhook reported ₹${webhookVerified.amount}`,
        },
      });
      void sendOpsAlert({
        title: "Topup HOLD — amount mismatch",
        severity: "critical",
        details: {
          refId,
          initiated: Number(txn.amount),
          confirmed: webhookVerified.amount,
          partner: txn.partner,
          userId: txn.userId,
        },
      });
      return { refId, status: "HOLD" };
    }

    // Instant T0 MDR settlement via dedicated capture function.
    const result = await handleTopupCapture({
      transactionId: txn.id,
      grossAmount: webhookVerified.amount,
      paymentMode: webhookVerified.paymentMode,
      providerRef: webhookVerified.reference,
      scopeKey: pgScopeForTxn(txn.partner ?? "CHAGANS_PG"),
    });

    if (result.status === "SETTLED") {
      void emitWebhookEvent(txn.userId, "topup.credited", {
        refId,
        amount: webhookVerified.amount,
        net: result.netAmount,
        provider: txn.partner,
      });
      return { refId, status: "SUCCESS", amount: webhookVerified.amount, net: result.netAmount };
    }
    if (result.status === "DUPLICATE") {
      return { refId, status: "SUCCESS", net: result.netAmount };
    }
    // NO_SCHEME — transaction already marked FAILED by handleTopupCapture.
    return { refId, status: "FAILED" };
  }

  // ── Standard poll path (Razorpay / mock) ──────────────────────────────────
  const upi = getUpiProviderByName(txn.partner);

  assertRealMoneyProvider(
    upi,
    () =>
      new TopupError(
        "Wallet top-up settlement is unavailable. Please contact support.",
        503,
        "PG_NOT_LIVE"
      )
  );

  const r = await upi.status(txn.partnerTxnId || refId);
  if (!r.ok) throw new TopupError(r.message, 502, r.code);

  if (r.data.status === "PAID") {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.transaction.updateMany({
        where: { id: txn.id, status: { in: ["INITIATED", "PROCESSING"] } },
        data: { status: "SUCCESS" },
      });
      if (claimed.count === 0) return;
      await creditWallet(
        {
          userId: txn.userId,
          amount: txn.amount,
          reason: "TOPUP",
          refType: "Transaction",
          refId: txn.id,
          note: `Wallet top-up ${refId}`,
          idempotencyKey: `topup:${txn.id}`,
        },
        tx
      );
      await tx.auditLog.create({
        data: {
          userId: txn.userId,
          action: "wallet.topup_credited",
          entity: "Transaction",
          entityId: txn.id,
          meta: { refId, amount: txn.amount.toString(), provider: txn.partner },
        },
      });
    });

    // Credit committed → recover any outstanding POS rent immediately.
    void schedulePosRentalRetryIfNeeded(txn.userId);

    void emitWebhookEvent(txn.userId, "topup.credited", {
      refId,
      amount: Number(txn.amount),
      provider: txn.partner,
    });
    return { refId, status: "SUCCESS", amount: Number(txn.amount) };
  }

  if (r.data.status === "FAILED" || r.data.status === "EXPIRED") {
    await prisma.transaction.updateMany({
      where: { id: txn.id, status: { in: ["INITIATED", "PROCESSING"] } },
      data: { status: "FAILED", errorCode: r.data.status },
    });
    return { refId, status: "FAILED" };
  }

  return { refId, status: "PROCESSING" };
}
