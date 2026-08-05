/**
 * Instant wallet top-up via the UPI/PG partner (BulkPe Simple PG, or
 * Razorpay/mock fallback — whatever getPartner("upi") resolves).
 *
 * Lifecycle:
 *   initiateTopup  -> Transaction(WALLET_TOPUP, INITIATED) + provider collect
 *                     (referenceId = our Transaction.refId)
 *   settleTopup    -> verifies status WITH THE PROVIDER (never trusts a
 *                     webhook body), then atomically marks SUCCESS and credits
 *                     the wallet. Idempotent: the ledger credit carries
 *                     idempotencyKey `topup:<txnId>` so webhook + poll + admin
 *                     retry can all race safely.
 */
import { nanoid } from "nanoid";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { creditWallet } from "../ledger";
import { getPartner } from "../partners";
import { round } from "../money";
import { emitWebhookEvent } from "../platform/webhooks";
import { assertPushWithinCap, WalletOpError } from "./operations";
import { recordPayin } from "./payin";

export type TopupState = "INITIATED" | "PROCESSING" | "SUCCESS" | "FAILED";

export class TopupError extends Error {
  public statusCode: number;
  constructor(message: string, statusCode = 400, public code = "TOPUP_ERROR") {
    super(message);
    this.name = "TopupError";
    this.statusCode = statusCode;
  }
}

export async function initiateTopup(input: {
  userId: string;
  amount: number;
  vpa?: string;
  note?: string;
  customerPhone: string;
  customerEmail?: string;
  ip?: string;
}): Promise<{ refId: string; orderId: string; paymentUrl?: string; upiIntent?: string; provider: string }> {
  // Wallet cap gate — refuse the collect up front rather than bouncing money
  // back after the customer has already paid.
  try {
    await assertPushWithinCap(input.userId, "PRIMARY", input.amount);
  } catch (e) {
    if (e instanceof WalletOpError) throw new TopupError(e.message, 400, e.code);
    throw e;
  }

  const upi = getPartner("upi");
  const refId = `TOPUP${nanoid(10).toUpperCase()}`;

  const txn = await prisma.transaction.create({
    data: {
      refId,
      userId: input.userId,
      service: "WALLET_TOPUP",
      amount: new Prisma.Decimal(round(input.amount)),
      status: "INITIATED",
      customer: input.customerPhone,
      partner: upi.name,
      request: { amount: input.amount, vpa: input.vpa ?? null, note: input.note ?? null } as Prisma.InputJsonValue,
      ipAddress: input.ip,
    },
  });

  const r = await upi.collect({
    userId: input.userId,
    idempotencyKey: refId,
    amount: input.amount,
    vpa: input.vpa,
    note: input.note ?? "Wallet top-up",
    customerPhone: input.customerPhone,
    customerEmail: input.customerEmail,
    callbackUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/wallet?topup=${refId}`,
  });

  if (!r.ok) {
    await prisma.transaction.update({
      where: { id: txn.id },
      data: { status: "FAILED", errorCode: r.code, errorMessage: r.message },
    });
    throw new TopupError(r.message, 502, r.code);
  }

  await prisma.transaction.update({
    where: { id: txn.id },
    data: {
      status: "PROCESSING",
      partnerTxnId: r.data.orderId,
      response: {
        paymentUrl: r.data.paymentUrl ?? null,
        upiIntent: r.data.upiIntent ?? null,
      } as Prisma.InputJsonValue,
    },
  });

  return {
    refId,
    orderId: r.data.orderId,
    paymentUrl: r.data.paymentUrl,
    upiIntent: r.data.upiIntent,
    provider: upi.name,
  };
}

/**
 * Poll the provider for the collect's state and settle our side. Safe to call
 * from the status endpoint, the PG webhook, and recon — all paths converge on
 * the same idempotent credit.
 */
export async function settleTopup(refId: string): Promise<{ refId: string; status: TopupState }> {
  const txn = await prisma.transaction.findUnique({ where: { refId } });
  if (!txn || txn.service !== "WALLET_TOPUP") {
    throw new TopupError("Top-up not found", 404, "NOT_FOUND");
  }
  if (txn.status === "SUCCESS") return { refId, status: "SUCCESS" };
  if (txn.status === "FAILED") return { refId, status: "FAILED" };

  const upi = getPartner("upi");
  const r = await upi.status(txn.partnerTxnId || refId);
  if (!r.ok) throw new TopupError(r.message, 502, r.code);

  if (r.data.status === "PAID") {
    await prisma.$transaction(async (tx) => {
      // Claim the terminal state first so concurrent settlers do nothing.
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
    // Mirror the GROSS into the company payin wallet (best-effort live monitor).
    // Idempotency-keyed, so a webhook + poll race counts the top-up once.
    await recordPayin({
      rail: "TOPUP",
      grossAmount: txn.amount,
      refType: "Transaction",
      refId: txn.id,
      note: `Wallet top-up payin ${refId}`,
    });
    // Partner webhook (best-effort; never blocks or fails the credit).
    void emitWebhookEvent(txn.userId, "topup.credited", {
      refId,
      amount: Number(txn.amount),
      provider: txn.partner,
    });
    return { refId, status: "SUCCESS" };
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
