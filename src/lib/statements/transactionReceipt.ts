import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { company } from "@/lib/data";
import { pdfSafe } from "@/lib/statements/walletStatement";

/**
 * Per-transaction receipt generation.
 *
 * Pure builder (receipt data → PDF bytes) so the layout stays unit-testable
 * without a database. The API route owns querying the Transaction + retailer
 * profile and computing the GST split; this module only renders.
 *
 * The GST breakdown treats the service `fee` as the taxable value and splits the
 * recorded `gst` into equal CGST / SGST halves (intra-state assumption — the
 * platform and retailer are both in Gujarat). `total` is the full amount the
 * retailer was debited: principal + fee + gst.
 */

export type ReceiptParty = {
  name: string;
  code: string | null;
  shopName: string | null;
  address: string | null;
  phone: string | null;
  gstin: string | null;
};

export type ReceiptData = {
  refId: string;
  service: string;
  status: "Success" | "Pending" | "Failed";
  date: Date;
  customer: string | null;
  operator: string | null;
  partnerTxnId: string | null;
  amount: number; // transaction principal
  fee: number; // service charge (taxable value)
  gst: number; // total GST on the fee
  cgst: number;
  sgst: number;
  gstRate: number; // whole-number rate, e.g. 18
  total: number; // amount + fee + gst
  /** null → hide the commission line entirely (retailer view). */
  commission: number | null;
  retailer: ReceiptParty;
};

const fmtINR = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDateTime = (d: Date) =>
  d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const M = 44;

export async function generateTransactionReceiptPdf(
  data: ReceiptData,
  /** Optional company logo bytes (PNG) for the letterhead. */
  logo?: Uint8Array
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const ink = rgb(0.1, 0.12, 0.18);
  const dim = rgb(0.42, 0.45, 0.52);
  const line = rgb(0.88, 0.89, 0.92);
  const brand = rgb(0.106, 0.271, 0.918); // brand-600 royal blue #1b45ea
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
  // Optional logo mark at the top-left; brand + company details flow to its right.
  const top = PAGE_H - M;
  let headTextX = M;
  if (logo) {
    try {
      const img = await doc.embedPng(logo);
      const logoSize = 46;
      page.drawImage(img, { x: M, y: top - logoSize, width: logoSize, height: logoSize });
      headTextX = M + logoSize + 12;
    } catch {
      // Corrupt/unsupported logo → fall back to text-only letterhead.
    }
  }

  y = top - 2;
  text(company.brand, headTextX, 18, bold, brand);
  y -= 13;
  text(company.legalName, headTextX, 8, font, dim);
  y -= 10;
  // Address may be long — wrap it under the brand block.
  for (const chunk of wrap(company.address, 62, font, 7.5)) {
    text(chunk, headTextX, 7.5, font, dim);
    y -= 9;
  }
  const idLine = [company.gstin ? `GSTIN: ${company.gstin}` : null, `CIN: ${company.cin}`]
    .filter(Boolean)
    .join("  ·  ");
  text(idLine, headTextX, 7.5, font, dim);
  y -= 9;
  text(`${company.supportEmail}  ·  ${company.phone}`, headTextX, 7.5, font, dim);

  // Title block (right aligned, top)
  rightAt("PAYMENT RECEIPT", PAGE_W - M, top - 2, 13, bold, ink);
  rightAt(`Receipt No: ${data.refId}`, PAGE_W - M, top - 18, 8.5, font, dim);
  rightAt(`Date: ${fmtDateTime(data.date)} IST`, PAGE_W - M, top - 30, 8.5, font, dim);

  y = Math.min(y, top - 44) - 6;
  rule(y, 1, brand);
  y -= 22;

  // ── Status pill ──
  const statusColor = data.status === "Success" ? ok : data.status === "Failed" ? bad : warn;
  text("Status:", M, 9, bold, dim);
  text(data.status.toUpperCase(), M + 44, 9, bold, statusColor);
  y -= 22;

  // ── Two-column meta: Billed to (left) · Transaction details (right) ──
  const colGap = 20;
  const colW = (PAGE_W - 2 * M - colGap) / 2;
  const leftX = M;
  const rightX = M + colW + colGap;
  const topY = y;

  const r = data.retailer;
  textAt("BILLED TO", leftX, topY, 8, bold, brand);
  let ly = topY - 15;
  textAt(r.name, leftX, ly, 10, bold);
  ly -= 12;
  if (r.shopName) {
    textAt(r.shopName, leftX, ly, 8.5, font, dim);
    ly -= 11;
  }
  if (r.code) {
    textAt(`Retailer code: ${r.code}`, leftX, ly, 8, font, dim);
    ly -= 11;
  }
  if (r.address) {
    for (const chunk of wrap(r.address, 42, font, 8)) {
      textAt(chunk, leftX, ly, 8, font, dim);
      ly -= 10;
    }
  }
  if (r.phone) {
    textAt(`Phone: ${r.phone}`, leftX, ly, 8, font, dim);
    ly -= 11;
  }
  if (r.gstin) {
    textAt(`GSTIN: ${r.gstin}`, leftX, ly, 8, font, dim);
    ly -= 11;
  }

  textAt("TRANSACTION DETAILS", rightX, topY, 8, bold, brand);
  let ry = topY - 15;
  const detail = (label: string, value: string) => {
    textAt(label, rightX, ry, 8, font, dim);
    textAt(value, rightX + 92, ry, 8.5, bold);
    ry -= 13;
  };
  detail("Service", data.service);
  if (data.operator) detail("Operator", data.operator);
  if (data.customer) detail("Customer", data.customer);
  detail("Reference ID", data.refId);
  if (data.partnerTxnId) detail("Partner Txn", data.partnerTxnId);

  y = Math.min(ly, ry) - 12;
  rule(y);
  y -= 20;

  // ── Amount / charge breakdown ──
  textAt("PARTICULARS", M, y, 8, bold, brand);
  rightAt("AMOUNT (INR)", PAGE_W - M, y, 8, bold, brand);
  y -= 8;
  rule(y);
  y -= 16;

  const row = (label: string, value: number, opts?: { bold?: boolean; color?: typeof ink; muted?: boolean }) => {
    const f = opts?.bold ? bold : font;
    const c = opts?.muted ? dim : opts?.color ?? ink;
    textAt(label, M, y, 9, f, c);
    rightAt(fmtINR(value), PAGE_W - M, y, 9, f, c);
    y -= 16;
  };

  row("Transaction amount", data.amount);
  if (data.fee > 0 || data.gst > 0) {
    row("Service charge (taxable value)", data.fee, { muted: true });
    if (data.gst > 0) {
      const half = data.gstRate / 2;
      row(`CGST @ ${fmtRate(half)}%`, data.cgst, { muted: true });
      row(`SGST @ ${fmtRate(half)}%`, data.sgst, { muted: true });
    }
  }

  y -= 2;
  rule(y);
  y -= 18;
  row("Total charged", data.total, { bold: true });

  if (data.commission !== null && data.commission > 0) {
    y -= 2;
    rule(y, 0.3);
    y -= 16;
    row("Commission (your earning)", data.commission, { color: ok, bold: true });
  }

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
      ["Taxable value", `Rs ${fmtINR(data.fee)}`],
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
  textAt(
    `For support, contact ${company.supportEmail} · ${company.phone}`,
    M,
    footerY - 11,
    7,
    font,
    dim
  );

  return doc.save();
}

/** One-decimal rate for the CGST/SGST halves (9% shown as "9", 2.5% as "2.5"). */
function fmtRate(rate: number): string {
  return Number.isInteger(rate) ? String(rate) : rate.toFixed(1);
}

/** Greedy word-wrap to fit a column width (points) at a given font size. */
function wrap(
  s: string,
  maxChars: number,
  _font: import("pdf-lib").PDFFont,
  _size: number
): string[] {
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
  return lines.slice(0, 3); // cap at 3 lines to keep the block tidy
}
