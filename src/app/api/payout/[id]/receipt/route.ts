import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PayoutStatus } from "@prisma/client";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { enforceRateLimit, RATE_LIMITS, RateLimitError } from "@/lib/security/rateLimit";
import { prisma } from "@/lib/db";
import { add, dec, toNumber } from "@/lib/money";
import { gstRate, splitCgstSgst } from "@/lib/reports/gstMath";
import { isAdminRole } from "@/lib/security/ownership";
import {
  generatePayoutReceiptPdf,
  type PayoutReceiptData,
} from "@/lib/statements/payoutReceipt";

/**
 * GET /api/payout/{id}/receipt            → JSON (for the preview modal)
 * GET /api/payout/{id}/receipt?format=pdf → downloadable PDF receipt
 *
 * The payout owner may fetch their own receipt; admin roles may fetch any.
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<PayoutStatus, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending approval",
  APPROVED: "Approved",
  PROCESSING: "Processing",
  SUCCESS: "Success",
  FAILED: "Failed",
  REJECTED: "Rejected",
  REVERSED: "Reversed",
};

function statusKind(status: PayoutStatus): "success" | "pending" | "failed" {
  if (status === "SUCCESS") return "success";
  if (status === "FAILED" || status === "REJECTED" || status === "REVERSED") return "failed";
  return "pending";
}

function composeAddress(u: {
  shopAddress: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
}): string | null {
  const parts = [u.shopAddress, u.city, u.state, u.pincode].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

async function loadLogo(): Promise<Uint8Array | undefined> {
  try {
    const buf = await readFile(path.join(process.cwd(), "public", "brand-mark.png"));
    return new Uint8Array(buf);
  } catch {
    return undefined;
  }
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  let user;
  try {
    user = await requireAuth();
    await enforceRateLimit(`payout:receipt:${user.id}`, RATE_LIMITS.reportQuery);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    if (e instanceof RateLimitError)
      return NextResponse.json(
        { error: e.message, retryAfterSec: e.result.retryAfterSec },
        { status: 429 }
      );
    throw e;
  }

  const po = await prisma.payoutRequest.findUnique({
    where: { id: params.id },
    include: {
      user: {
        select: {
          name: true,
          userCode: true,
          phone: true,
          shopName: true,
          shopAddress: true,
          city: true,
          state: true,
          pincode: true,
          kyc: { select: { gstin: true } },
        },
      },
    },
  });

  const isAdmin = isAdminRole(user.role);
  if (!po || (!isAdmin && po.userId !== user.id)) {
    return NextResponse.json({ error: "Payout not found" }, { status: 404 });
  }

  // GST breakdown: the service charge is the taxable value; split into CGST/SGST.
  const chargeDec = dec(po.serviceCharge);
  const gstDec = dec(po.gst);
  const { cgst, sgst } = splitCgstSgst(gstDec);

  const data: PayoutReceiptData = {
    reference: po.providerReferenceId || po.id,
    status: STATUS_LABEL[po.status],
    statusKind: statusKind(po.status),
    date: po.createdAt,
    payer: {
      name: po.user.name,
      code: po.user.userCode,
      shopName: po.user.shopName,
      address: composeAddress(po.user),
      phone: po.user.phone,
      gstin: po.user.kyc?.gstin ?? null,
    },
    beneficiary: {
      name: po.beneficiaryName,
      accountLast4: po.accountLast4,
      mode: po.mode,
      utr: po.utr,
    },
    amount: toNumber(po.amount),
    serviceCharge: toNumber(chargeDec),
    gst: toNumber(gstDec),
    cgst: toNumber(cgst),
    sgst: toNumber(sgst),
    gstRate: gstRate(gstDec, chargeDec),
    totalDebit: toNumber(add(add(po.amount, chargeDec), gstDec)),
  };

  const format = new URL(req.url).searchParams.get("format");

  if (format === "pdf") {
    const logo = await loadLogo();
    const pdf = await generatePayoutReceiptPdf(data, logo);
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="payout-receipt-${data.reference}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json({ ok: true, data });
}
