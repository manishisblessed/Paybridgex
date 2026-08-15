import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { pdfSafe } from "./walletStatement";

/**
 * Commission certificate (Phase 3 — agent experience).
 *
 * An annual (financial-year) certificate of commission earned on the
 * platform — agents use it for ITR filing and loan applications. Data comes
 * from the WalletTxn ledger (reason=COMMISSION credits), so it always matches
 * what was actually paid out.
 */

export type CommissionCertificateData = {
  certificateNo: string;
  accountName: string;
  accountPhone: string;
  role: string;
  /** e.g. "FY 2025-26" */
  periodLabel: string;
  from: Date;
  to: Date;
  /** month label (e.g. "Apr 2025") → commission amount */
  monthly: Array<{ label: string; amount: number }>;
  total: number;
};

/** Financial-year window for an Indian FY starting in `startYear` (April 1). */
export function fyWindow(startYear: number): { from: Date; to: Date; label: string } {
  // IST offset in the constructor keeps the boundary at Indian midnight.
  return {
    from: new Date(`${startYear}-04-01T00:00:00+05:30`),
    to: new Date(`${startYear + 1}-03-31T23:59:59.999+05:30`),
    label: `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`,
  };
}

/** The FY a given date belongs to (April–March). */
export function fyStartYearOf(d: Date): number {
  const ist = new Date(d.getTime() + 5.5 * 3600_000);
  return ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
}

const fmtINR = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 56;

export async function generateCommissionCertificatePdf(
  data: CommissionCertificateData
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const ink = rgb(0.1, 0.12, 0.18);
  const dim = rgb(0.42, 0.45, 0.52);
  const line = rgb(0.88, 0.89, 0.92);
  const brand = rgb(0.106, 0.271, 0.918); // brand-600 royal blue #1b45ea

  const page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - M;

  const text = (raw: string, x: number, size = 10, f = font, color = ink) =>
    page.drawText(pdfSafe(raw), { x, y, size, font: f, color });
  const center = (raw: string, size = 10, f = font, color = ink) => {
    const s = pdfSafe(raw);
    const w = f.widthOfTextAtSize(s, size);
    page.drawText(s, { x: (PAGE_W - w) / 2, y, size, font: f, color });
  };
  const right = (raw: string, xRight: number, size = 10, f = font, color = ink) => {
    const s = pdfSafe(raw);
    const w = f.widthOfTextAtSize(s, size);
    page.drawText(s, { x: xRight - w, y, size, font: f, color });
  };

  // Border frame
  page.drawRectangle({
    x: M / 2,
    y: M / 2,
    width: PAGE_W - M,
    height: PAGE_H - M,
    borderColor: line,
    borderWidth: 1.5,
  });

  center("Paybridgex", 22, bold, brand);
  y -= 20;
  center("K.A. PAYBRIDGEX SOLUTION (OPC) PRIVATE LIMITED", 9, font, dim);
  y -= 36;

  center("COMMISSION CERTIFICATE", 15, bold);
  y -= 14;
  center(data.periodLabel, 11, bold, dim);
  y -= 30;

  text(`Certificate no: ${data.certificateNo}`, M, 9, font, dim);
  right(
    `Issued: ${new Date().toLocaleDateString("en-IN", { dateStyle: "long", timeZone: "Asia/Kolkata" })}`,
    PAGE_W - M,
    9,
    font,
    dim
  );
  y -= 28;

  const para = [
    `This is to certify that ${data.accountName} (registered mobile ${data.accountPhone}),`,
    `engaged as ${data.role.replace(/_/g, " ").toLowerCase()} on the Paybridgex platform, has earned the`,
    `following commission during ${data.periodLabel} (${data.from.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })} to ${data.to.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}):`,
  ];
  for (const l of para) {
    text(l, M, 10.5);
    y -= 16;
  }
  y -= 14;

  // Monthly table
  const tableRight = PAGE_W - M;
  text("Month", M, 9, bold, dim);
  right("Commission earned (Rs)", tableRight, 9, bold, dim);
  y -= 6;
  page.drawLine({ start: { x: M, y }, end: { x: tableRight, y }, thickness: 0.8, color: line });
  y -= 16;

  for (const m of data.monthly) {
    text(m.label, M, 10);
    right(fmtINR(m.amount), tableRight, 10);
    y -= 4;
    page.drawLine({ start: { x: M, y }, end: { x: tableRight, y }, thickness: 0.3, color: line });
    y -= 13;
  }

  y -= 4;
  text("Total", M, 11, bold);
  right(`Rs ${fmtINR(data.total)}`, tableRight, 12, bold, brand);
  y -= 8;
  page.drawLine({ start: { x: M, y }, end: { x: tableRight, y }, thickness: 1, color: line });
  y -= 30;

  const notes = [
    "Notes:",
    "1. Amounts are gross commission credited to the wallet ledger before any applicable TDS.",
    "2. This certificate is generated from the platform's transaction ledger and is valid without signature.",
    "3. For TDS certificates (Form 16A), refer to the TRACES portal against the platform's TAN.",
  ];
  for (const n of notes) {
    text(n, M, 8.5, n === "Notes:" ? bold : font, dim);
    y -= 13;
  }

  return doc.save();
}
