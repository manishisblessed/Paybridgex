/**
 * PG (payment gateway) merchant collection — initiation + settlement.
 *
 * Mirrors the wallet top-up flow (src/lib/wallet/topup.ts) but for a RETAILER's
 * UPI/PG collection that settles scheme-priced through the PG engine:
 *
 *   initiatePgCollect -> Transaction(UPI_COLLECT, INITIATED) + provider collect
 *                        (provider referenceId = our Transaction.refId `PGC…`)
 *   settlePgCollect   -> verifies status WITH THE PROVIDER (never trusts a
 *                        webhook body), marks SUCCESS, and hands the confirmed
 *                        collection to `handlePgCapture`, which prices MDR
 *                        against the retailer's scheme, credits the NET, and
 *                        mirrors the GROSS into the company payin wallet.
 *
 * This is what makes live PG payins flow: the BulkPe PG webhook (and the status
 * poll) resolve a `PGC…` reference to its Transaction and settle it here.
 */
import { nanoid } from "nanoid";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { getPartner } from "../partners";
import { round } from "../money";
import { handlePgCapture } from "../settlement/pg";

export type PgCollectState = "INITIATED" | "PROCESSING" | "SUCCESS" | "FAILED";

export class PgCollectError extends Error {
  public statusCode: number;
  constructor(message: string, statusCode = 400, public code = "PG_COLLECT_ERROR") {
    super(message);
    this.name = "PgCollectError";
    this.statusCode = statusCode;
  }
}

/** True when a reference belongs to the PG merchant-collection flow. */
export function isPgCollectRef(referenceId: string | undefined | null): boolean {
  return !!referenceId && referenceId.startsWith("PGC");
}

export async function initiatePgCollect(input: {
  userId: string;
  amount: number;
  vpa?: string;
  note?: string;
  customerPhone: string;
  customerEmail?: string;
  ip?: string;
}): Promise<{ refId: string; orderId: string; paymentUrl?: string; upiIntent?: string; provider: string }> {
  const upi = getPartner("upi");
  const refId = `PGC${nanoid(10).toUpperCase()}`;

  const txn = await prisma.transaction.create({
    data: {
      refId,
      userId: input.userId,
      service: "UPI_COLLECT",
      amount: new Prisma.Decimal(round(input.amount)),
      status: "INITIATED",
      customer: input.customerPhone,
      partner: upi.name,
      request: {
        amount: input.amount,
        vpa: input.vpa ?? null,
        note: input.note ?? null,
      } as Prisma.InputJsonValue,
      ipAddress: input.ip,
    },
  });

  const r = await upi.collect({
    userId: input.userId,
    idempotencyKey: refId,
    amount: input.amount,
    vpa: input.vpa,
    note: input.note ?? "UPI collection",
    customerPhone: input.customerPhone,
    customerEmail: input.customerEmail,
    callbackUrl: `${process.env.NEXT_PUBLIC_APP_URL}/upi/callback?ref=${refId}`,
  });

  if (!r.ok) {
    await prisma.transaction.update({
      where: { id: txn.id },
      data: { status: "FAILED", errorCode: r.code, errorMessage: r.message },
    });
    throw new PgCollectError(r.message, 502, r.code);
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
 * the same idempotent PG capture (net credit + payin mirror). The Transaction is
 * only marked SUCCESS once the retailer has actually been settled, so a capture
 * that can't yet be priced (NO_SCHEME) stays PROCESSING for a later retry.
 */
export async function settlePgCollect(refId: string): Promise<{ refId: string; status: PgCollectState }> {
  const txn = await prisma.transaction.findUnique({ where: { refId } });
  if (!txn || txn.service !== "UPI_COLLECT") {
    throw new PgCollectError("Collection not found", 404, "NOT_FOUND");
  }
  if (txn.status === "SUCCESS") return { refId, status: "SUCCESS" };
  if (txn.status === "FAILED") return { refId, status: "FAILED" };

  const upi = getPartner("upi");
  const r = await upi.status(txn.partnerTxnId || refId);
  if (!r.ok) throw new PgCollectError(r.message, 502, r.code);

  if (r.data.status === "PAID") {
    // Settle to the retailer through the scheme-priced PG engine. Idempotent via
    // the `pg-settle:<ref>` ledger key + the PgSettlementEntry unique ref.
    const result = await handlePgCapture({
      transactionRef: refId,
      orderId: txn.partnerTxnId ?? undefined,
      userId: txn.userId,
      grossAmount: Number(txn.amount),
      paymentMode: "UPI",
    });

    // Only close the Transaction once the money has actually been settled or was
    // already handled. NO_SCHEME / SKIPPED leaves it PROCESSING so a later
    // webhook/poll retries once the scheme is configured.
    if (result.status === "SETTLED" || result.status === "QUEUED" || result.status === "DUPLICATE") {
      await prisma.transaction.updateMany({
        where: { id: txn.id, status: { in: ["INITIATED", "PROCESSING"] } },
        data: { status: "SUCCESS" },
      });
      await prisma.auditLog.create({
        data: {
          userId: txn.userId,
          action: "pg.collect_settled",
          entity: "Transaction",
          entityId: txn.id,
          meta: { refId, amount: txn.amount.toString(), settle: result.status, net: result.netAmount ?? null },
        },
      });
      return { refId, status: "SUCCESS" };
    }
    return { refId, status: "PROCESSING" };
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
