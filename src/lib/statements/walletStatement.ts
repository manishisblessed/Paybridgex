import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

/**
 * Wallet statement generation (Phase 3 — agent experience).
 *
 * Pure builders (rows → CSV / PDF bytes) so the money formatting is
 * unit-testable without a database. The API route owns querying WalletTxn
 * and computing the opening balance; this module only renders.
 */

export type StatementRow = {
  date: Date;
  description: string;
  ref: string | null;
  debit: number | null;
  credit: number | null;
  balanceAfter: number;
};

export type StatementData = {
  accountName: string;
  accountPhone: string;
  role: string;
  from: Date;
  to: Date;
  openingBalance: number;
  closingBalance: number;
  totalCredits: number;
  totalDebits: number;
  rows: StatementRow[];
};

export const REASON_LABELS: Record<string, string> = {
  TOPUP: "Wallet top-up",
  WITHDRAW: "Withdrawal",
  TRANSACTION: "Service transaction",
  COMMISSION: "Commission",
  REVERSAL: "Refund / reversal",
  ADJUSTMENT: "Adjustment",
  FUND_TRANSFER_IN: "Fund received",
  FUND_TRANSFER_OUT: "Fund sent",
  FEE: "Fee",
  PENALTY: "Penalty",
  PAYOUT: "Payout",
  RENTAL: "POS rental",
};

const fmtINR = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Standard PDF fonts only cover WinAnsi (Latin-1). User-entered notes/names may
 * contain ₹ or non-Latin scripts, which would make pdf-lib throw mid-render —
 * map what we can and drop the rest instead of failing the whole statement.
 */
export function pdfSafe(s: string): string {
  return s
    .replace(/\u20B9/g, "Rs ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2014|\u2013/g, "-")
    .replace(/\u2026/g, "...")
    // Anything else outside printable Latin-1 becomes '?'.
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

const fmtDateTime = (d: Date) =>
  d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

/** RFC-4180-safe CSV cell. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildStatementCsv(data: StatementData): string {
  const lines: string[] = [];
  lines.push(`Wallet statement,${csvCell(data.accountName)} (${csvCell(data.accountPhone)})`);
  lines.push(`Period,${fmtDate(data.from)} to ${fmtDate(data.to)}`);
  lines.push(`Opening balance,${data.openingBalance.toFixed(2)}`);
  lines.push(`Closing balance,${data.closingBalance.toFixed(2)}`);
  lines.push("");
  lines.push("Date,Description,Reference,Debit,Credit,Balance");
  for (const r of data.rows) {
    lines.push(
      [
        csvCell(fmtDateTime(r.date)),
        csvCell(r.description),
        csvCell(r.ref),
        r.debit !== null ? r.debit.toFixed(2) : "",
        r.credit !== null ? r.credit.toFixed(2) : "",
        r.balanceAfter.toFixed(2),
      ].join(",")
    );
  }
  lines.push("");
  lines.push(`Totals,,,${data.totalDebits.toFixed(2)},${data.totalCredits.toFixed(2)},`);
  return lines.join("\r\n");
}

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const M = 40;

export async function generateWalletStatementPdf(data: StatementData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const ink = rgb(0.1, 0.12, 0.18);
  const dim = rgb(0.42, 0.45, 0.52);
  const line = rgb(0.88, 0.89, 0.92);
  const brand = rgb(0.106, 0.271, 0.918); // brand-600 royal blue #1b45ea

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - M;

  const cols = [
    { x: M, w: 95, label: "Date" },
    { x: M + 95, w: 165, label: "Description" },
    { x: M + 260, w: 90, label: "Reference" },
    { x: M + 350, w: 55, label: "Debit", right: true },
    { x: M + 405, w: 55, label: "Credit", right: true },
    { x: M + 460, w: 55, label: "Balance", right: true },
  ] as const;

  function text(raw: string, x: number, size = 9, f = font, color = ink) {
    page.drawText(pdfSafe(raw), { x, y, size, font: f, color });
  }
  function rightText(raw: string, xRight: number, size = 9, f = font, color = ink) {
    const s = pdfSafe(raw);
    const w = f.widthOfTextAtSize(s, size);
    page.drawText(s, { x: xRight - w, y, size, font: f, color });
  }
  function drawHeaderRow() {
    for (const c of cols) {
      if ("right" in c && c.right) rightText(c.label, c.x + c.w, 8, bold, dim);
      else text(c.label, c.x, 8, bold, dim);
    }
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: PAGE_W - M, y }, thickness: 0.7, color: line });
    y -= 12;
  }
  function newPage() {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - M;
    drawHeaderRow();
  }

  // ── Letterhead ──
  text("Paybridgex", M, 18, bold, brand);
  y -= 16;
  text("Wallet Statement", M, 11, bold);
  y -= 20;

  text(`Account holder:  ${data.accountName}  ·  ${data.accountPhone}  ·  ${data.role.replace(/_/g, " ")}`, M, 9, font, dim);
  y -= 13;
  text(`Period:  ${fmtDate(data.from)} — ${fmtDate(data.to)}`, M, 9, font, dim);
  y -= 13;
  text(`Generated:  ${fmtDateTime(new Date())} IST`, M, 9, font, dim);
  y -= 20;

  // ── Summary band ──
  const summary: Array<[string, string]> = [
    ["Opening balance", `Rs ${fmtINR(data.openingBalance)}`],
    ["Total credits", `Rs ${fmtINR(data.totalCredits)}`],
    ["Total debits", `Rs ${fmtINR(data.totalDebits)}`],
    ["Closing balance", `Rs ${fmtINR(data.closingBalance)}`],
  ];
  const bandW = (PAGE_W - 2 * M) / summary.length;
  summary.forEach(([label, value], i) => {
    const x = M + i * bandW;
    page.drawText(label, { x, y, size: 7.5, font, color: dim });
    page.drawText(value, { x, y: y - 13, size: 10, font: bold, color: ink });
  });
  y -= 34;
  page.drawLine({ start: { x: M, y }, end: { x: PAGE_W - M, y }, thickness: 1, color: line });
  y -= 16;

  // ── Table ──
  drawHeaderRow();
  const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + "…" : s);

  for (const r of data.rows) {
    if (y < M + 30) newPage();
    text(fmtDateTime(r.date), cols[0].x, 7.5);
    text(clip(r.description, 38), cols[1].x, 8);
    text(clip(r.ref ?? "—", 18), cols[2].x, 7.5, font, dim);
    rightText(r.debit !== null ? fmtINR(r.debit) : "—", cols[3].x + cols[3].w, 8, font, r.debit !== null ? rgb(0.75, 0.15, 0.25) : dim);
    rightText(r.credit !== null ? fmtINR(r.credit) : "—", cols[4].x + cols[4].w, 8, font, r.credit !== null ? rgb(0.05, 0.55, 0.35) : dim);
    rightText(fmtINR(r.balanceAfter), cols[5].x + cols[5].w, 8, bold);
    y -= 4;
    page.drawLine({ start: { x: M, y }, end: { x: PAGE_W - M, y }, thickness: 0.3, color: line });
    y -= 11;
  }

  if (data.rows.length === 0) {
    text("No wallet activity in this period.", M, 9, font, dim);
    y -= 14;
  }

  // ── Footer ──
  if (y < M + 40) newPage();
  y = Math.max(y - 10, M + 20);
  text(
    "This is a system-generated statement and does not require a signature. Balances are in INR.",
    M,
    7,
    font,
    dim
  );

  return doc.save();
}
