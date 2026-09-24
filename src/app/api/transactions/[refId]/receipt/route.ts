import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { TxnStatus } from "@prisma/client";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { enforceRateLimit, RATE_LIMITS, RateLimitError } from "@/lib/security/rateLimit";
import { prisma } from "@/lib/db";
import { add, dec, sub, toNumber } from "@/lib/money";
import { gstRate, splitCgstSgst } from "@/lib/reports/gstMath";
import { isAdminRole } from "@/lib/security/ownership";
import {
  generateTransactionReceiptPdf,
  type ReceiptData,
} from "@/lib/statements/transactionReceipt";

/**
 * GET /api/transactions/{refId}/receipt          → JSON (for the preview modal)
 * GET /api/transactions/{refId}/receipt?format=pdf → downloadable PDF receipt
 *
 * Retailers may only fetch receipts for their own transactions; admin roles may
 * fetch any. Commission is hidden from the retailer view (consistent with the
 * transaction feed — on settlement rails the per-txn commission is the upline's).
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

function displayStatus(status: TxnStatus): "Success" | "Pending" | "Failed" {
  if (status === "SUCCESS") return "Success";
  if (status === "FAILED" || status === "REFUNDED") return "Failed";
  return "Pending";
}

function formatService(service: string, operator: string | null): string {
  const label = service
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
  return operator ? `${label} - ${operator}` : label;
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

/** Load the brand mark for the PDF letterhead; null if it can't be read. */
async function loadLogo(): Promise<Uint8Array | undefined> {
  try {
    const buf = await readFile(path.join(process.cwd(), "public", "brand-mark.png"));
    return new Uint8Array(buf);
  } catch {
    return undefined;
  }
}

export async function GET(req: Request, { params }: { params: { refId: string } }) {
  let user;
  try {
    user = await requireAuth();
    await enforceRateLimit(`txn:receipt:${user.id}`, RATE_LIMITS.reportQuery);
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

  const t = await prisma.transaction.findUnique({
    where: { refId: params.refId },
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
  if (!t || (!isAdmin && t.userId !== user.id)) {
    return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  }

  // GST breakdown. IMPORTANT: `Transaction.fee` is GST-INCLUSIVE — it already
  // contains `Transaction.gst` (see the pay routes: feeMoney = charge + gst, or
  // the gst-inclusive charge itself). The wallet is debited `amount + fee` only
  // (runTransaction.reserveAmount), GST is never added on top again. So:
  //   taxable value = fee − gst      (the ex-GST service charge)
  //   GST rate      = gst / taxable  (→ 18% = 9% CGST + 9% SGST)
  //   total charged = amount + fee
  const feeDec = dec(t.fee); // GST-inclusive service charge
  const gstDec = dec(t.gst); // GST portion contained within the fee
  const taxableDec = sub(feeDec, gstDec); // ex-GST taxable value
  const { cgst, sgst } = splitCgstSgst(gstDec);
  const total = add(t.amount, feeDec);

  // Retailers never see commission (see /api/transactions rationale).
  const hideCommission = user.role === "RETAILER";

  const data: ReceiptData = {
    refId: t.refId,
    service: formatService(t.service, t.operator),
    status: displayStatus(t.status),
    date: t.createdAt,
    customer: t.customer,
    operator: t.operator,
    partnerTxnId: t.partnerTxnId,
    amount: toNumber(t.amount),
    fee: toNumber(taxableDec), // shown as "Service charge (taxable value)"
    gst: toNumber(gstDec),
    cgst: toNumber(cgst),
    sgst: toNumber(sgst),
    gstRate: gstRate(gstDec, taxableDec),
    total: toNumber(total),
    commission: hideCommission ? null : toNumber(t.commission),
    retailer: {
      name: t.user.name,
      code: t.user.userCode,
      shopName: t.user.shopName,
      address: composeAddress(t.user),
      phone: t.user.phone,
      gstin: t.user.kyc?.gstin ?? null,
    },
  };

  const format = new URL(req.url).searchParams.get("format");

  if (format === "pdf") {
    const logo = await loadLogo();
    const pdf = await generateTransactionReceiptPdf(data, logo);
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="receipt-${data.refId}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json({ ok: true, data });
}
