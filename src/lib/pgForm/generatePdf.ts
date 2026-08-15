import PDFDocument from "pdfkit";
import { readFile } from "fs/promises";
import { join } from "path";
import type { PgFormData } from "./data";

// Palette / geometry mirror the self-declaration PDF so both documents look
// like they came from the same onboarding pack.
const BRAND = "#1b45ea";
const INK = "#0f172a";
const MUTED = "#475569";
const LINE = "#cbd5e1";
const BAR_BG = "#eef2ff";
const PAGE_MARGIN = 48;

let cachedFontBytes: Buffer | null = null;

async function loadHindiFont(): Promise<Buffer> {
  if (cachedFontBytes) return cachedFontBytes;
  const fontPath = join(process.cwd(), "public", "fonts", "NotoSansDevanagari-Regular.ttf");
  cachedFontBytes = await readFile(fontPath);
  return cachedFontBytes;
}

const DEVANAGARI = /[\u0900-\u097F]/;
const hasHindi = (t: string) => DEVANAGARI.test(t);

type Doc = InstanceType<typeof PDFDocument>;

function fontFor(t: string, bold = false) {
  return hasHindi(t) ? "Hindi" : bold ? "Helvetica-Bold" : "Helvetica";
}

export async function generatePgFormPdf(data: PgFormData): Promise<Uint8Array> {
  const fontBytes = await loadHindiFont();
  const doc: Doc = new PDFDocument({
    size: "A4",
    margins: { top: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN },
    bufferPages: true,
    info: {
      Title: "Payment Gateway Onboarding Form",
      Author: "K.A. PAYBRIDGEX SOLUTION (OPC) PRIVATE LIMITED",
    },
  });
  doc.registerFont("Hindi", fontBytes);

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Uint8Array>((resolve) => {
    doc.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
  });

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const contentWidth = right - left;

  function ensureSpace(needed: number) {
    if (doc.y + needed > doc.page.height - doc.page.margins.bottom) doc.addPage();
  }

  function header() {
    doc.font("Helvetica-Bold").fontSize(18).fillColor(BRAND).text(
      "K.A. PAYBRIDGEX SOLUTION (OPC) PRIVATE LIMITED",
      left,
      PAGE_MARGIN,
      { align: "center", width: contentWidth }
    );
    doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text(
      "Payment Gateway Onboarding Form",
      { align: "center", width: contentWidth }
    );
    doc.y += 2;
    doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(
      "भुगतान गेटवे ऑनबोर्डिंग प्रपत्र",
      { align: "center", width: contentWidth }
    );
    doc.y += 4;
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(
      `Date: ${data.date || "__ / __ / ____"}`,
      { align: "center", width: contentWidth }
    );
    doc.y += 10;
    doc.moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(1).strokeColor(BRAND).stroke();
    doc.y += 12;
  }

  function sectionBar(title: string) {
    ensureSpace(34);
    const h = 22;
    const y = doc.y;
    doc.save();
    doc.roundedRect(left, y, contentWidth, h, 4).fill(BAR_BG);
    doc.rect(left, y, 3, h).fill(BRAND);
    doc.restore();
    doc.font("Helvetica-Bold").fontSize(11).fillColor(BRAND).text(
      title.toUpperCase(),
      left + 12,
      y + 6,
      { width: contentWidth - 24 }
    );
    doc.y = y + h + 8;
    doc.fillColor(INK);
  }

  function drawFieldAt(x: number, top: number, w: number, label: string, value: string): number {
    const shown = value && value.trim() ? value.trim() : "\u2014";
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(MUTED);
    doc.text(label.toUpperCase(), x, top, { width: w });
    const labelH = doc.heightOfString(label.toUpperCase(), { width: w });
    const vy = top + labelH + 1;
    doc.font(fontFor(shown)).fontSize(10.5).fillColor(INK);
    doc.text(shown, x, vy, { width: w });
    const valueH = doc.heightOfString(shown, { width: w });
    return vy + valueH;
  }

  function fieldRow(a: [string, string], b?: [string, string]) {
    ensureSpace(44);
    const top = doc.y;
    if (!b) {
      doc.y = drawFieldAt(left, top, contentWidth, a[0], a[1]) + 8;
      return;
    }
    const colW = (contentWidth - 16) / 2;
    const b1 = drawFieldAt(left, top, colW, a[0], a[1]);
    const b2 = drawFieldAt(left + colW + 16, top, colW, b[0], b[1]);
    doc.y = Math.max(b1, b2) + 8;
  }

  const field = (label: string, value: string) => fieldRow([label, value]);

  function heading(text: string) {
    ensureSpace(24);
    doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text(text, left, doc.y);
    doc.y += 4;
    doc.moveTo(left, doc.y).lineTo(left + 40, doc.y).lineWidth(2).strokeColor(BRAND).stroke();
    doc.y += 8;
  }

  function paragraph(text: string, opts: { indent?: number; gap?: number; size?: number } = {}) {
    const size = opts.size ?? 9.5;
    const indent = opts.indent ?? 0;
    const w = contentWidth - indent;
    doc.font(fontFor(text)).fontSize(size).fillColor(INK);
    ensureSpace(doc.heightOfString(text, { width: w, lineGap: 2 }) + (opts.gap ?? 6));
    doc.text(text, left + indent, doc.y, { width: w, align: "justify", lineGap: 2 });
    doc.y += opts.gap ?? 6;
  }

  function signatureBlock(name: string) {
    ensureSpace(90);
    const boxTop = doc.y;
    const colW = (contentWidth - 24) / 2;

    doc.font("Helvetica-Bold").fontSize(9).fillColor(MUTED).text("APPLICANT NAME", left, boxTop);
    doc.font(fontFor(name)).fontSize(10.5).fillColor(INK).text(name || "\u2014", left, doc.y + 1, {
      width: colW,
    });

    const sigY = boxTop + 34;
    doc.font("Helvetica-Bold").fontSize(9).fillColor(MUTED).text("SIGNATURE", left, sigY);
    doc.moveTo(left, sigY + 54).lineTo(left + colW, sigY + 54).lineWidth(0.7).strokeColor(LINE).stroke();

    doc.font("Helvetica-Bold").fontSize(9).fillColor(MUTED).text("DATE", left + colW + 24, sigY);
    doc.moveTo(left + colW + 24, sigY + 54).lineTo(right, sigY + 54).lineWidth(0.7).strokeColor(LINE).stroke();

    doc.y = sigY + 66;
    doc.fillColor(INK);
  }

  function companyUseOnly() {
    sectionBar("Company Use Only");
    fieldRow(["Verified By", ""], ["Employee ID", ""]);
    fieldRow(["Approval Date", ""], ["MID / TID", ""]);
    doc.y += 6;
    doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text("Authorized Signatory", left, doc.y);
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(
      "K.A. PAYBRIDGEX SOLUTION (OPC) PRIVATE LIMITED",
      left,
      doc.y + 2
    );
  }

  function footer(disclaimer: string) {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const savedBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const fy = doc.page.height - 30;
      doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text(disclaimer, left, fy, {
        width: contentWidth - 60,
        lineBreak: false,
      });
      doc.text(`Page ${i + 1} of ${range.count}`, right - 60, fy, {
        width: 60,
        align: "right",
        lineBreak: false,
      });
      doc.page.margins.bottom = savedBottom;
    }
  }

  header();

  sectionBar("Applicant Details");
  fieldRow(["Applicant Name", data.applicantName], ["Applicant ID", data.applicantId]);
  fieldRow(["Business / Shop Name", data.businessName], ["Role", data.role]);
  fieldRow(["Mobile No.", data.mobile], ["Email ID", data.email]);
  fieldRow(["PAN No.", data.pan], ["Aadhaar No.", data.aadhaar]);
  field("Business Address", data.address);
  if (data.gstin) field("GSTIN", data.gstin);
  doc.y += 4;

  sectionBar("Settlement Bank Account");
  fieldRow(
    ["Account Holder Name", data.bankAccountHolder],
    ["Bank Name", data.bankName]
  );
  fieldRow(
    ["Account Number", data.bankAccountNumber],
    ["IFSC", data.bankIfsc]
  );
  doc.y += 4;

  heading("Merchant Declaration & Undertaking");

  const applicant = data.applicantName || "_______________";
  paragraph(
    `मैं, ${applicant}, यह घोषित करता/करती हूँ कि K.A. PAYBRIDGEX SOLUTION (OPC) PRIVATE LIMITED (Paybridgex) ` +
      `के Payment Gateway की सुविधा हेतु मेरे द्वारा दी गई समस्त जानकारी, KYC दस्तावेज़, बैंक खाता ` +
      `एवं व्यवसाय संबंधी विवरण सत्य, सही एवं मेरे स्वयं के हैं। मैं निम्नलिखित शर्तों से पूर्णतः सहमत हूँ—`
  );

  const clauses = [
    "1. I authorize K.A. PAYBRIDGEX SOLUTION (OPC) PRIVATE LIMITED (\u201cPaybridgex\u201d) to enable Payment Gateway services on my merchant ID and to settle funds to the bank account listed above.",
    "2. I will use the Payment Gateway only for lawful, genuine business transactions of the category disclosed at onboarding and will not process gambling, betting, crypto, foreign remittance misuse, third-party fund pass-through or any other prohibited activity.",
    "3. I am solely responsible for every transaction, chargeback, dispute, refund, penalty and fraud arising from my merchant ID, and I authorize Paybridgex to debit my wallet / settlement balance / security deposit to recover any amount due.",
    "4. I will submit updated KYC, business proof and bank documents whenever requested, and I understand that failure to do so may result in suspension of settlements and / or termination of services.",
    "5. I agree to the platform Terms of Service, Privacy Policy, MDR / fee schedule and Merchant Operating Guidelines published by Paybridgex, as amended from time to time.",
    "6. I confirm that this form is signed voluntarily, without any coercion, and forms part of the binding merchant relationship with Paybridgex.",
  ];
  for (const c of clauses) paragraph(c, { indent: 10, gap: 5 });
  doc.y += 4;

  sectionBar("Applicant Signature");
  signatureBlock(data.applicantName);

  companyUseOnly();

  footer("This is a system-generated Payment Gateway onboarding form. K.A. PAYBRIDGEX SOLUTION (OPC) PRIVATE LIMITED.");
  doc.end();
  return done;
}
