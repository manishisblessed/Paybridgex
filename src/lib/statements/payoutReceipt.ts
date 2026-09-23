import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { company } from "@/lib/data";
import { pdfSafe } from "@/lib/statements/walletStatement";

/**
 * Per-payout receipt generation.
 *
 * Pure builder (payout data → PDF bytes), matching the visual language of the
 * transaction receipt. A payout debits the sender's wallet by
 * `amount + serviceCharge + gst` (the beneficiary receives `amount`); the GST is
 * charged on the service charge and split into equal CGST / SGST halves
 * (intra-state assumption).
 */

export type PayoutReceiptParty = {
  name: string;
  code: string | null;
  shopName: string | null;
  address: string | null;
  phone: string | null;
  gstin: string | null;
};

export type PayoutReceiptData = {
  reference: string; // human-facing reference (PO… provider ref, or id)
  status: string; // display label, e.g. "Success"
  statusKind: "success" | "pending" | "failed";
  date: Date;
  payer: PayoutReceiptParty; // the retailer sending the payout
  beneficiary: {
    name: string;
    accountLast4: string;
    mode: string; // IMPS
    utr: string | null;
  };
  amount: number; // beneficiary receives
  serviceCharge: number; // taxable value
  gst: number; // total GST on the service charge
  cgst: number;
  sgst: number;
  gstRate: number; // whole-number rate, e.g. 18
  totalDebit: number; // amount + serviceCharge + gst
};

const fmtINR = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDateTime = (d: Date) =>
  d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const M = 44;

export async function generatePayoutReceiptPdf(
  data: PayoutReceiptData,
  logo?: Uint8Array
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const ink = rgb(0.1, 0.12, 0.18);
  const dim = rgb(0.42, 0.45, 0.52);
  const line = rgb(0.88, 0.89, 0.92);
  const brand = rgb(0.106, 0.271, 0.918);
  const ok = rgb(0.05, 0.55, 0.35);
  const warn = rgb(0.78, 0.5, 0.05);
  const bad = rgb(0.75, 0.15, 0.25);

  const page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - M;

  const text = (raw: string, x: number, size = 9, f = font, color = ink) =>
    page.drawText(pdfSafe(raw), { x, y, size, font: f, color });
  const textAt = (raw: string, x: number, yy: number, size = 9, f = font, color = ink) =>
    page.drawText(pdfSafe(raw), { x, y: yy, size, font: f, color });
  const rightAt = (raw: string, xRight: number, yy: number, size = 9, f = font, color = ink) => {
    const s = pdfSafe(raw);
    const w = f.widthOfTextAtSize(s, size);
    page.drawText(s, { x: xRight - w, y: yy, size, font: f, color });
  };
  const rule = (yy: number, thickness = 0.7, color = line) =>
    page.drawLine({ start: { x: M, y: yy }, end: { x: PAGE_W - M, y: yy }, thickness, color });

  // ── Letterhead ──
  const top = PAGE_H - M;
  let headTextX = M;
  if (logo) {
    try {
      const img = await doc.embedPng(logo);
      const logoSize = 46;
      page.drawImage(img, { x: M, y: top - logoSize, width: logoSize, height: logoSize });
      headTextX = M + logoSize + 12;
    } catch {
      /* fall back to text-only letterhead */
    }
  }

  y = top - 2;
  text(company.brand, headTextX, 18, bold, brand);
  y -= 13;
  text(company.legalName, headTextX, 8, font, dim);
  y -= 10;
  for (const chunk of wrap(company.address, 62)) {
    text(chunk, headTextX, 7.5, font, dim);
    y -= 9;
  }
  const idLine = [company.gstin ? `GSTIN: ${company.gstin}` : null, `CIN: ${company.cin}`]
    .filter(Boolean)
    .join("  ·  ");
  text(idLine, headTextX, 7.5, font, dim);
  y -= 9;
  text(`${company.supportEmail}  ·  ${company.phone}`, headTextX, 7.5, font, dim);

  rightAt("PAYOUT RECEIPT", PAGE_W - M, top - 2, 13, bold, ink);
  rightAt(`Reference: ${data.reference}`, PAGE_W - M, top - 18, 8.5, font, dim);
  rightAt(`Date: ${fmtDateTime(data.date)} IST`, PAGE_W - M, top - 30, 8.5, font, dim);

  y = Math.min(y, top - 44) - 6;
  rule(y, 1, brand);
  y -= 22;

  // ── Status ──
  const statusColor = data.statusKind === "success" ? ok : data.statusKind === "failed" ? bad : warn;
  text("Status:", M, 9, bold, dim);
  text(data.status.toUpperCase(), M + 44, 9, bold, statusColor);
  y -= 22;

  // ── Two columns: From (payer) · Beneficiary ──
  const colGap = 20;
  const colW = (PAGE_W - 2 * M - colGap) / 2;
  const leftX = M;
  const rightX = M + colW + colGap;
  const topY = y;

  const p = data.payer;
  textAt("FROM", leftX, topY, 8, bold, brand);
  let ly = topY - 15;
  textAt(p.name, leftX, ly, 10, bold);
  ly -= 12;
  if (p.shopName) {
    textAt(p.shopName, leftX, ly, 8.5, font, dim);
    ly -= 11;
  }
  if (p.code) {
    textAt(`Retailer code: ${p.code}`, leftX, ly, 8, font, dim);
    ly -= 11;
  }
  if (p.address) {
    for (const chunk of wrap(p.address, 42)) {
      textAt(chunk, leftX, ly, 8, font, dim);
      ly -= 10;
    }
  }
  if (p.phone) {
    textAt(`Phone: ${p.phone}`, leftX, ly, 8, font, dim);
    ly -= 11;
  }
  if (p.gstin) {
    textAt(`GSTIN: ${p.gstin}`, leftX, ly, 8, font, dim);
    ly -= 11;
  }

  textAt("BENEFICIARY", rightX, topY, 8, bold, brand);
  let ry = topY - 15;
  const detail = (label: string, value: string) => {
    textAt(label, rightX, ry, 8, font, dim);
    textAt(value, rightX + 78, ry, 8.5, bold);
    ry -= 13;
  };
  detail("Name", data.beneficiary.name);
  detail("Account", `****${data.beneficiary.accountLast4}`);
  detail("Mode", data.beneficiary.mode);
  if (data.beneficiary.utr) detail("UTR", data.beneficiary.utr);

  y = Math.min(ly, ry) - 12;
  rule(y);
  y -= 20;

  // ── Breakdown ──
  textAt("PARTICULARS", M, y, 8, bold, brand);
  rightAt("AMOUNT (INR)", PAGE_W - M, y, 8, bold, brand);
  y -= 8;
  rule(y);
  y -= 16;

  const row = (label: string, value: number, opts?: { bold?: boolean; muted?: boolean }) => {
    const f = opts?.bold ? bold : font;
    const c = opts?.muted ? dim : ink;
    textAt(label, M, y, 9, f, c);
    rightAt(fmtINR(value), PAGE_W - M, y, 9, f, c);
    y -= 16;
  };

  row("Payout amount (beneficiary receives)", data.amount);
  row("Service charge (taxable value)", data.serviceCharge, { muted: true });
  if (data.gst > 0) {
    const half = data.gstRate / 2;
    row(`CGST @ ${fmtRate(half)}%`, data.cgst, { muted: true });
    row(`SGST @ ${fmtRate(half)}%`, data.sgst, { muted: true });
  }

  y -= 2;
  rule(y);
  y -= 18;
  row("Total debited from your wallet", data.totalDebit, { bold: true });

  // ── GST summary strip ──
  if (data.gst > 0) {
    y -= 10;
    const boxTop = y;
    const boxH = 30;
    page.drawRectangle({
      x: M,
      y: boxTop - boxH,
      width: PAGE_W - 2 * M,
      height: boxH,
      color: rgb(0.96, 0.97, 1),
      borderColor: line,
      borderWidth: 0.5,
    });
    const cell = (PAGE_W - 2 * M) / 4;
    const summary: Array<[string, string]> = [
      ["Taxable value", `Rs ${fmtINR(data.serviceCharge)}`],
      ["CGST", `Rs ${fmtINR(data.cgst)}`],
      ["SGST", `Rs ${fmtINR(data.sgst)}`],
      ["Total GST", `Rs ${fmtINR(data.gst)}`],
    ];
    summary.forEach(([label, value], i) => {
      const x = M + i * cell + 10;
      textAt(label, x, boxTop - 12, 7, font, dim);
      textAt(value, x, boxTop - 24, 9, bold, ink);
    });
    y = boxTop - boxH - 16;
  }

  // ── Footer ──
  const footerY = M + 26;
  page.drawLine({ start: { x: M, y: footerY + 14 }, end: { x: PAGE_W - M, y: footerY + 14 }, thickness: 0.5, color: line });
  textAt(
    "This is a system-generated receipt and does not require a signature. All amounts are in INR.",
    M,
    footerY,
    7,
    font,
    dim
  );
  textAt(`For support, contact ${company.supportEmail} · ${company.phone}`, M, footerY - 11, 7, font, dim);

  return doc.save();
}

function fmtRate(rate: number): string {
  return Number.isInteger(rate) ? String(rate) : rate.toFixed(1);
}

/** Greedy word-wrap capped at 3 lines to keep blocks tidy. */
function wrap(s: string, maxChars: number): string[] {
  const words = s.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}
