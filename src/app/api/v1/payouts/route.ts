import { NextResponse } from "next/server";
import { z } from "zod";
import { nanoid } from "nanoid";
import { prisma } from "@/lib/db";
import { flags } from "@/lib/env";
import { holdFunds, LedgerError } from "@/lib/ledger";
import { toNumber } from "@/lib/money";
import { encryptField } from "@/lib/crypto/fieldEncryption";
import { requireApiKey } from "@/lib/platform/apiKeys";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { withIdempotency } from "@/lib/idempotency";
import { assertTransactionRisk } from "@/lib/risk/engine";
import { assertKycCurrent } from "@/lib/security/kycGate";
import { assertLivenessReadyById } from "@/lib/security/livenessGate";
import { assertServiceEnabled } from "@/lib/services/guard";
import { SERVICE_KEYS } from "@/lib/services/catalog";
import { quotePayoutForUser } from "@/lib/payout/charges";
import { enqueuePayoutInitiate } from "@/lib/payout/service";
import { requireActiveScheme } from "@/lib/scheme/gate";
import { getSchemeLimit, PAYOUT_MODE_SERVICE } from "@/lib/scheme/resolver";
import { dec, gt } from "@/lib/money";
import type { SessionUser } from "@/lib/auth-server";

/**
 * Partner API v1 — /api/v1/payouts
 *   POST — create a payout (scope: payout.create). Requires an
 *          Idempotency-Key header; funds are held and the payout auto-approves
 *          (it debits the requester's own wallet) then queues for disbursal.
 *   GET  — list recent payouts (scope: payout.read)
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_RE = /^\d{9,18}$/;
const VPA_RE = /^[\w.\-]{2,256}@[a-zA-Z]{2,64}$/;

const CreateBody = z
  .object({
    mode: z.enum(["IMPS", "NEFT", "RTGS", "UPI"]),
    amount: z.number().positive().max(500000),
    beneficiaryName: z.string().trim().min(2).max(120),
    accountNumber: z.string().trim().optional(),
    ifsc: z.string().trim().toUpperCase().optional(),
    vpa: z.string().trim().optional(),
    remarks: z.string().trim().max(200).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.mode === "UPI") {
      if (!v.vpa || !VPA_RE.test(v.vpa)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["vpa"], message: "Valid UPI ID required" });
      }
    } else {
      if (!v.accountNumber || !ACCOUNT_RE.test(v.accountNumber)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["accountNumber"], message: "Account number must be 9-18 digits" });
      }
      if (!v.ifsc || !IFSC_RE.test(v.ifsc)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ifsc"], message: "Invalid IFSC code" });
      }
    }
  });

function serialize(r: {
  id: string;
  mode: string;
  beneficiaryName: string;
  accountLast4: string | null;
  amount: unknown;
  serviceCharge: unknown;
  gst: unknown;
  totalDebit: unknown;
  status: string;
  utr: string | null;
  failureReason: string | null;
  createdAt: Date;
  completedAt: Date | null;
}) {
  return {
    id: r.id,
    mode: r.mode,
    beneficiaryName: r.beneficiaryName,
    accountLast4: r.accountLast4,
    amount: toNumber(r.amount as never),
    serviceCharge: toNumber(r.serviceCharge as never),
    gst: toNumber(r.gst as never),
    totalDebit: toNumber(r.totalDebit as never),
    status: r.status,
    utr: r.utr,
    failureReason: r.failureReason,
    createdAt: r.createdAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
  };
}

export async function GET(req: Request) {
  try {
    const { user } = await requireApiKey(req, ["payout.read"]);
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 25, 1), 100);

    const rows = await prisma.payoutRequest.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return NextResponse.json({ ok: true, data: rows.map(serialize) });
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function POST(req: Request) {
  if (!flags.payout) {
    return NextResponse.json(
      { ok: false, error: { code: "SERVICE_DISABLED", message: "Payout service is currently disabled" } },
      { status: 503 }
    );
  }

  let ctx;
  try {
    ctx = await requireApiKey(req, ["payout.create"]);
    // Same compliance gates as the dashboard flow.
    await assertLivenessReadyById(ctx.user.id);
    await assertKycCurrent({ id: ctx.user.id, role: ctx.user.role } as SessionUser);
    await assertServiceEnabled(SERVICE_KEYS.PAYOUT, { name: "Payout", userId: ctx.user.id, role: ctx.user.role });
    await requireActiveScheme(ctx.user.id);
  } catch (e) {
    return toErrorResponse(e);
  }

  const idemKey = req.headers.get("Idempotency-Key") || req.headers.get("idempotency-key");
  if (!idemKey || idemKey.length < 8 || idemKey.length > 128) {
    return NextResponse.json(
      { ok: false, error: { code: "IDEMPOTENCY_KEY_REQUIRED", message: "Provide an Idempotency-Key header (8-128 chars) on payout creation" } },
      { status: 400 }
    );
  }

  const parsed = CreateBody.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: { code: "VALIDATION", message: "Invalid payout request", details: parsed.error.flatten() } },
      { status: 400 }
    );
  }
  const body = parsed.data;
  const userId = ctx.user.id;

  try {
    const payoutService = PAYOUT_MODE_SERVICE[body.mode];
    if (payoutService) {
      const limit = await getSchemeLimit(userId, payoutService);
      if (limit && gt(dec(body.amount), limit)) {
        return NextResponse.json(
          { ok: false, error: { code: "AMOUNT_EXCEEDS_LIMIT", message: `Amount exceeds the maximum allowed limit of ₹${limit.toNumber().toLocaleString("en-IN")}` } },
          { status: 400 }
        );
      }
    }

    const quote = await quotePayoutForUser(userId, body.amount, body.mode);

    const handleForRisk = body.mode === "UPI" ? body.vpa! : body.accountNumber!;
    await assertTransactionRisk({
      userId,
      service: "PAYOUT",
      amount: quote.totalDebit,
      beneficiary: { accountLast4: handleForRisk.replace(/@.*/, "").slice(-4), mode: body.mode },
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: `api-key:${ctx.apiKey.keyId}`,
    });

    const result = await withIdempotency(
      { key: idemKey, scope: "payout.create", userId },
      async () => {
        const isUpi = body.mode === "UPI";
        const handle = isUpi ? body.vpa! : body.accountNumber!;
        const accountLast4 = handle.replace(/@.*/, "").slice(-4);
        const bulkpeReferenceId = `PO${nanoid(18).toUpperCase()}`;

        // A payout always debits the requester's OWN held wallet balance —
        // it is their own money, so no second-party approval is required.
        const autoApprove = true;

        const created = await prisma.$transaction(async (tx) => {
          await holdFunds({ userId, amount: quote.totalDebit }, tx);
          return tx.payoutRequest.create({
            data: {
              userId,
              makerId: userId,
              beneficiaryName: body.beneficiaryName,
              accountNumber: encryptField(handle),
              ifsc: !isUpi && body.ifsc ? encryptField(body.ifsc) : null,
              accountLast4,
              mode: body.mode,
              amount: quote.amount,
              serviceCharge: quote.serviceCharge,
              gst: quote.gst,
              totalDebit: quote.totalDebit,
              status: autoApprove ? "APPROVED" : "PENDING_APPROVAL",
              bulkpeReferenceId,
              remarks: body.remarks ? `[API] ${body.remarks}` : "[API]",
              ...(autoApprove ? { approvedAt: new Date() } : {}),
            },
          });
        });

        await prisma.auditLog.create({
          data: {
            userId,
            action: "payout.submitted",
            entity: "PayoutRequest",
            entityId: created.id,
            meta: {
              via: "partner-api",
              apiKeyId: ctx.apiKey.keyId,
              mode: created.mode,
              amount: toNumber(created.amount),
              totalDebit: toNumber(created.totalDebit),
              accountLast4: created.accountLast4,
              ...(autoApprove ? { autoApproved: true } : {}),
            },
          },
        });

        if (autoApprove) {
          await enqueuePayoutInitiate(created.id);
        }

        return serialize(created);
      }
    );

    return NextResponse.json({ ok: true, data: result }, { status: 201 });
  } catch (e) {
    if (e instanceof LedgerError && e.code === "INSUFFICIENT_FUNDS") {
      return NextResponse.json(
        { ok: false, error: { code: "INSUFFICIENT_FUNDS", message: "Insufficient spendable balance for this payout" } },
        { status: 400 }
      );
    }
    return toErrorResponse(e);
  }
}
