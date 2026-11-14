import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { assertServiceEnabled } from "@/lib/services/guard";
import { SERVICE_KEYS } from "@/lib/services/catalog";
import { chagansCcCheckStatus } from "@/lib/partners/chagans-cc-bill";
import { prisma } from "@/lib/db";

const Body = z
  .object({
    orderId: z.string().min(1).optional(),
    refId: z.string().min(1).optional(),
  })
  .refine((d) => d.orderId || d.refId, {
    message: "Either orderId (provider txn ID) or refId (our txn ID) is required",
  });

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * POST /api/services/chagans-cc/status
 *
 * Transaction status check for Chagans CC Bill payments.
 */
export async function POST(req: Request) {
  try {
    const session = await requireAuth();
    await assertServiceEnabled(SERVICE_KEYS.BBPS_CHAGANS, {
      name: "CC Bill Payment",
      userId: session.id,
    });
    await enforceRateLimit(
      `chagans-cc:status:${session.id}`,
      RATE_LIMITS.default
    );

    const body = Body.parse(await req.json());

    let orderId = body.orderId;

    if (!orderId && body.refId) {
      const txn = await prisma.transaction.findFirst({
        where: {
          refId: body.refId,
          userId: session.id,
          partner: "CHAGANS_CC_BILL",
        },
        select: { partnerTxnId: true },
      });
      if (!txn?.partnerTxnId) {
        return NextResponse.json(
          {
            ok: false,
            code: "NOT_FOUND",
            message:
              "No CC Bill transaction found for this refId, or it has no provider transaction ID yet",
          },
          { status: 404 }
        );
      }
      orderId = txn.partnerTxnId;
    }

    const result = await chagansCcCheckStatus(orderId!);

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          code: result.code ?? "PROVIDER_ERROR",
          message: result.message ?? "Status check failed",
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      data: {
        orderId: result.data.orderId,
        status: result.data.status,
        amount: result.data.amount ?? null,
        message: result.data.message ?? null,
      },
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(
        { ok: false, code: "AUTH_ERROR", message: err.message },
        { status: 401 }
      );
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        {
          ok: false,
          code: "VALIDATION_ERROR",
          message: err.errors.map((e) => e.message).join("; "),
        },
        { status: 400 }
      );
    }
    return toErrorResponse(err);
  }
}
