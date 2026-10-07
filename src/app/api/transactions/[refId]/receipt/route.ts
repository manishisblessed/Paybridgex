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
import { payoutDisplayStatus, payoutServiceLabel } from "@/lib/payout/display";
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

  const isAdmin = isAdminRole(user.role);
  // Retailers never see commission (see /api/transactions rationale).
  const hideCommission = user.role === "RETAILER";

  const userSelect = {
    name: true,
    userCode: true,
    phone: true,
    shopName: true,
    shopAddress: true,
    city: true,
    state: true,
    pincode: true,
    kyc: { select: { gstin: true } },
  } as const;

  const t = await prisma.transaction.findUnique({
    where: { refId: params.refId },
    include: { user: { select: userSelect } },
  });

  let data: ReceiptData | null = null;

  if (t && (isAdmin || t.userId === user.id)) {
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

    data = {
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
      gstRate: t.gstRate > 0 ? t.gstRate : gstRate(gstDec, taxableDec),
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
  } else if (!t) {
    // Fallback: payouts live on PayoutRequest (not the Transaction table) and are
    // folded into the feed keyed by their own id — resolve the receipt from there.
    //   PayoutRequest.serviceCharge is EX-GST; gst is 18% of it; the user is
    //   debited totalDebit = amount + serviceCharge + gst.
    const p = await prisma.payoutRequest.findUnique({
      where: { id: params.refId },
      include: { user: { select: userSelect } },
    });

    if (p && (isAdmin || p.userId === user.id)) {
      const feeDec = dec(p.serviceCharge); // ex-GST taxable service charge
      const gstDec = dec(p.gst);
      const { cgst, sgst } = splitCgstSgst(gstDec);

      data = {
        refId: p.id,
        service: payoutServiceLabel(p.mode),
        status: payoutDisplayStatus(p.status),
        date: p.createdAt,
        customer: `${p.beneficiaryName} ••${p.accountLast4}`,
        operator: p.mode,
        partnerTxnId: p.providerTxnId ?? p.utr,
        amount: toNumber(p.amount),
        fee: toNumber(feeDec),
        gst: toNumber(gstDec),
        cgst: toNumber(cgst),
        sgst: toNumber(sgst),
        gstRate: p.gstRate > 0 ? p.gstRate : gstRate(gstDec, feeDec),
        total: toNumber(p.totalDebit),
        // Payouts carry no per-txn commission.
        commission: hideCommission ? null : 0,
        retailer: {
          name: p.user.name,
          code: p.user.userCode,
          shopName: p.user.shopName,
          address: composeAddress(p.user),
          phone: p.user.phone,
          gstin: p.user.kyc?.gstin ?? null,
        },
      };
    }
  }

  if (!data) {
    return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  }

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
