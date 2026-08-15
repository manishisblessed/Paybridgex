import PDFDocument from "pdfkit";
import { readFile } from "fs/promises";
import { join } from "path";
import type { DeclarationData, ApprovalEvidence } from "./types";
import { getCreatorRoleLabel, getOnboardeeRoleLabel } from "./types";

// ── Palette / geometry ──────────────────────────────────────────────────────
const BRAND = "#1b45ea";
const INK = "#0f172a";
const MUTED = "#475569";
const LINE = "#cbd5e1";
const BAR_BG = "#eef2ff";
const OK_BG = "#ecfdf5";
const OK_LINE = "#a7f3d0";
const OK_INK = "#065f46";
const PAGE_MARGIN = 48;

let cachedFontBytes: Buffer | null = null;

async function loadHindiFont(): Promise<Buffer> {
  if (cachedFontBytes) return cachedFontBytes;
  const fontPath = join(process.cwd(), "public", "fonts", "NotoSansDevanagari-Regular.ttf");
  cachedFontBytes = await readFile(fontPath);
  return cachedFontBytes;
}

// Any Devanagari code point → we must render with the embedded shaping font.
const DEVANAGARI = /[\u0900-\u097F]/;
const hasHindi = (t: string) => DEVANAGARI.test(t);

type Doc = InstanceType<typeof PDFDocument>;

// A small toolkit of layout helpers bound to a single PDFKit document.
function createBuilder(fontBytes: Buffer, meta: { title: string }) {
  const doc: Doc = new PDFDocument({
    size: "A4",
    margins: { top: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN },
    bufferPages: true,
    info: { Title: meta.title, Author: "K.A. PAYBRIDGEX SOLUTION (OPC) PRIVATE LIMITED" },
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

  const fontFor = (t: string, bold = false) =>
    hasHindi(t) ? "Hindi" : bold ? "Helvetica-Bold" : "Helvetica";

  function ensureSpace(needed: number) {
    if (doc.y + needed > doc.page.height - doc.page.margins.bottom) doc.addPage();
  }

  function header(title: string, subtitle: string, date: string) {
    doc.font("Helvetica-Bold").fontSize(18).fillColor(BRAND).text(
      "K.A. PAYBRIDGEX SOLUTION (OPC) PRIVATE LIMITED",
      left,
      PAGE_MARGIN,
      { align: "center", width: contentWidth }
    );
    doc.font(fontFor(subtitle, true)).fontSize(12).fillColor(INK).text(subtitle, {
      align: "center",
      width: contentWidth,
    });
    doc.y += 4;
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(`Date: ${date || "__ / __ / ____"}`, {
      align: "center",
      width: contentWidth,
    });
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
    doc.font("Helvetica-Bold").fontSize(11).fillColor(BRAND).text(title.toUpperCase(), left + 12, y + 6, {
      width: contentWidth - 24,
    });
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

  // Signature line block. If `evidence` is supplied the drawn signature image,
  // date and captured location are embedded in place of the blank lines.
  function signatureBlock(name: string, evidence?: ApprovalEvidence) {
    ensureSpace(evidence ? 130 : 90);
    const boxTop = doc.y;
    const colW = (contentWidth - 24) / 2;

    doc.font("Helvetica-Bold").fontSize(9).fillColor(MUTED).text("NAME", left, boxTop);
    doc.font(fontFor(name)).fontSize(10.5).fillColor(INK).text(name || "\u2014", left, doc.y + 1, {
      width: colW,
    });

    const sigY = boxTop + 34;
    doc.font("Helvetica-Bold").fontSize(9).fillColor(MUTED).text("SIGNATURE", left, sigY);
    if (evidence?.signaturePng) {
      try {
        doc.image(Buffer.from(evidence.signaturePng), left, sigY + 12, { fit: [colW, 40] });
      } catch {
        /* fall through to line */
      }
    }
    doc.moveTo(left, sigY + 54).lineTo(left + colW, sigY + 54).lineWidth(0.7).strokeColor(LINE).stroke();

    doc.font("Helvetica-Bold").fontSize(9).fillColor(MUTED).text("DATE", left + colW + 24, sigY);
    if (evidence?.approvedAt) {
      doc.font("Helvetica").fontSize(10).fillColor(INK).text(evidence.approvedAt, left + colW + 24, sigY + 14, {
        width: colW,
      });
    }
    doc.moveTo(left + colW + 24, sigY + 54).lineTo(right, sigY + 54).lineWidth(0.7).strokeColor(LINE).stroke();

    doc.y = sigY + 66;
    doc.fillColor(INK);
  }

  // Green "approved" evidence panel with selfie + location + IP + timestamp.
  function approvalEvidenceBlock(evidence: ApprovalEvidence) {
    ensureSpace(150);
    const top = doc.y;
    const selfieW = 96;
    const selfieH = 96;
    const boxH = selfieH + 24;
    doc.save();
    doc.roundedRect(left, top, contentWidth, boxH, 6).fill(OK_BG);
    doc.roundedRect(left, top, contentWidth, boxH, 6).lineWidth(1).strokeColor(OK_LINE).stroke();
    doc.restore();

    doc.font("Helvetica-Bold").fontSize(10).fillColor(OK_INK).text("APPROVAL EVIDENCE", left + 12, top + 10);

    // Selfie on the right
    const selfieX = right - selfieW - 12;
    const selfieY = top + 12;
    if (evidence.selfieJpg) {
      try {
        doc.image(Buffer.from(evidence.selfieJpg), selfieX, selfieY, { fit: [selfieW, selfieH] });
        doc.roundedRect(selfieX, selfieY, selfieW, selfieH, 4).lineWidth(0.7).strokeColor(OK_LINE).stroke();
      } catch {
        /* ignore */
      }
    }

    const infoTop = top + 30;
    const label = (t: string, v: string, y: number) => {
      doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED).text(t.toUpperCase(), left + 12, y);
      doc.font(fontFor(v)).fontSize(9.5).fillColor(INK).text(v, left + 12, y + 10, {
        width: contentWidth - selfieW - 48,
      });
    };
    label("Approved By", evidence.approverName || "\u2014", infoTop);
    label(
      "Location (Lat, Lng)",
      evidence.latitude != null && evidence.longitude != null
        ? `${evidence.latitude.toFixed(6)}, ${evidence.longitude.toFixed(6)}`
        : "\u2014",
      infoTop + 24
    );
    label(
      "Timestamp / IP",
      `${evidence.approvedAt ?? "\u2014"}${evidence.ip ? `  \u00b7  IP ${evidence.ip}` : ""}`,
      infoTop + 48
    );

    doc.y = top + boxH + 10;
  }

  function companyUseOnly() {
    sectionBar("Company Use Only");
    fieldRow(["Verified By", ""], ["Employee ID", ""]);
    field("Approval Date", "");
    doc.y += 6;
    doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text("Authorized Signatory", left, doc.y);
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text("K.A. PAYBRIDGEX SOLUTION (OPC) PRIVATE LIMITED", left, doc.y + 2);
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

  function finish(disclaimer: string): Promise<Uint8Array> {
    footer(disclaimer);
    doc.end();
    return done;
  }

  return {
    doc,
    left,
    right,
    contentWidth,
    header,
    sectionBar,
    field,
    fieldRow,
    heading,
    paragraph,
    signatureBlock,
    approvalEvidenceBlock,
    companyUseOnly,
    finish,
  };
}

const DISCLAIMER =
  "This is a system-generated declaration. K.A. PAYBRIDGEX SOLUTION (OPC) PRIVATE LIMITED.";

// ─────────────────────────────────────────────────────────────────────────────
// SELF DECLARATION — first person, signed & uploaded by the onboardee.
// ─────────────────────────────────────────────────────────────────────────────
export async function generateSelfDeclarationPdf(data: DeclarationData): Promise<Uint8Array> {
  const onboardeeLabel = getOnboardeeRoleLabel(data.onboardeeRole).en;
  const creatorLabel = getCreatorRoleLabel(data.creatorRole).en;
  const b = createBuilder(await loadHindiFont(), {
    title: `${onboardeeLabel} Self-Declaration & Undertaking`,
  });

  b.header(`${onboardeeLabel} Self-Declaration & Undertaking Form`, "स्व-घोषणा एवं उत्तरदायित्व प्रपत्र", data.date);

  b.sectionBar(`${onboardeeLabel} Details`);
  b.fieldRow([`${onboardeeLabel} Name`, data.onboardeeName], [`${onboardeeLabel} ID`, data.onboardeeId]);
  b.fieldRow(["Business Name", data.onboardeeBusiness], ["Mobile No.", data.onboardeeMobile]);
  b.fieldRow(["Email ID", data.onboardeeEmail], ["PAN No.", data.onboardeePan]);
  b.field("Aadhaar No.", data.onboardeeAadhaar);
  b.field("Address", data.onboardeeAddress);
  b.field("Sponsor / Upline", data.creatorName ? `${data.creatorName} (${creatorLabel})` : "");
  b.doc.y += 4;

  b.heading("Declaration & Undertaking");

  const name = data.onboardeeName || "_______________";
  b.paragraph(
    `मैं, ${name}, ${onboardeeLabel}, यह घोषित करता/करती हूँ कि Paybridgex (K.A. PAYBRIDGEX SOLUTION (OPC) PRIVATE LIMITED) पर पंजीकरण हेतु मेरे द्वारा दी गई समस्त जानकारी एवं दस्तावेज़ (KYC, PAN, Aadhaar, बैंक, GST आदि) सत्य, सही एवं मेरे स्वयं के हैं। मैं निम्नलिखित शर्तों से पूर्णतः सहमत हूँ—`
  );

  const clauses = [
    "1. मैं अपने अकाउंट (ID) से की जाने वाली समस्त लेन-देन एवं गतिविधियों के लिए पूर्णतः स्वयं उत्तरदायी रहूँगा/रहूँगी।",
    "2. मैं किसी भी प्रकार का Chargeback, Fraud Transaction, Dispute, Unauthorized Transaction, Money Laundering, Gaming Transaction, Betting Transaction, Crypto Related Transaction, Foreign Remittance Misuse, Third Party Fund Misuse अथवा किसी भी प्रकार की अवैध या संदिग्ध वित्तीय गतिविधि नहीं करूँगा/करूँगी।",
    "3. मैं KYC, नियमों एवं लागू कानूनों का पालन करूँगा/करूँगी तथा कंपनी द्वारा मांगे जाने पर आवश्यक दस्तावेज़, जानकारी एवं जांच में पूर्ण सहयोग दूँगा/दूँगी।",
    "4. मेरी किसी भी गतिविधि से कंपनी को होने वाले किसी भी वित्तीय नुकसान, चार्जबैक, पेनल्टी, कानूनी खर्च अथवा अन्य किसी भी प्रकार की हानि की भरपाई मैं स्वयं करूँगा/करूँगी।",
    "5. मैं स्वीकार करता/करती हूँ कि कंपनी केवल सेवा प्रदाता (Service Provider) है तथा मेरी गतिविधियों की अंतिम जिम्मेदारी मेरी स्वयं की है।",
    "6. यह घोषणा मेरी स्वेच्छा से, बिना किसी दबाव के दी जा रही है और यह कंपनी के साथ मेरे व्यावसायिक संबंधों का अभिन्न हिस्सा होगी।",
  ];
  for (const c of clauses) b.paragraph(c, { indent: 10, gap: 5 });
  b.doc.y += 4;

  b.sectionBar(`${onboardeeLabel} Signature`);
  b.signatureBlock(data.onboardeeName);

  return b.finish(DISCLAIMER);
}

// ─────────────────────────────────────────────────────────────────────────────
// SUCCESSOR RESPONSIBILITY & INDEMNITY — reviewed & signed by the upline.
// When `evidence` is supplied the rendered signature/selfie/location are baked
// in as the final, legally-binding, approved record.
// ─────────────────────────────────────────────────────────────────────────────
export async function generateSuccessorDeclarationPdf(
  data: DeclarationData,
  evidence?: ApprovalEvidence
): Promise<Uint8Array> {
  const creatorLabel = getCreatorRoleLabel(data.creatorRole).en;
  const onboardeeLabel = getOnboardeeRoleLabel(data.onboardeeRole).en;
  const b = createBuilder(await loadHindiFont(), {
    title: `${creatorLabel} Responsibility & Indemnity Undertaking`,
  });

  b.header(
    `${creatorLabel} Responsibility & Indemnity Undertaking Form`,
    "उत्तरदायित्व एवं क्षतिपूर्ति वचनपत्र",
    data.date
  );

  b.sectionBar(`${creatorLabel} Details`);
  b.fieldRow([`${creatorLabel} Name`, data.creatorName], [`${creatorLabel} ID`, data.creatorId]);
  b.fieldRow(["Company / Firm Name", data.creatorCompany], ["Mobile No.", data.creatorMobile]);
  b.fieldRow(["Email ID", data.creatorEmail], ["PAN No.", data.creatorPan]);
  b.field("Aadhaar No.", data.creatorAadhaar);
  b.field("Address", data.creatorAddress);
  b.doc.y += 4;

  b.sectionBar(`${onboardeeLabel} Details`);
  b.fieldRow([`${onboardeeLabel} Name`, data.onboardeeName], [`${onboardeeLabel} ID`, data.onboardeeId]);
  b.fieldRow(["Business Name", data.onboardeeBusiness], ["Mobile No.", data.onboardeeMobile]);
  b.fieldRow(["Email ID", data.onboardeeEmail], ["PAN No.", data.onboardeePan]);
  b.field("Aadhaar No.", data.onboardeeAadhaar);
  b.field("Address", data.onboardeeAddress);
  b.doc.y += 6;

  b.heading("Declaration & Undertaking");

  const cName = data.creatorName || "_______________";
  b.paragraph(
    `मैं, ${cName}, ${creatorLabel}, यह घोषित करता/करती हूँ कि मैंने ऊपर दिए गए ${onboardeeLabel} की KYC, व्यवसाय एवं पहचान का सत्यापन अपनी जानकारी के अनुसार किया है तथा मैं इस ${onboardeeLabel} की पूर्ण जिम्मेदारी स्वीकार करता/करती हूँ।`
  );
  b.paragraph("मैं निम्नलिखित शर्तों से पूर्णतः सहमत हूँ—", { gap: 4 });

  const clauses = [
    `1. यदि उक्त ${onboardeeLabel} द्वारा किसी भी प्रकार का Chargeback, Fraud Transaction, Dispute, Unauthorized Transaction, Money Laundering, Gaming Transaction, Betting Transaction, Crypto Related Transaction, Unaccounted/Unsourced Fund, Foreign Remittance Misuse, Third Party Fund Misuse अथवा किसी भी प्रकार की अवैध या संदिग्ध वित्तीय गतिविधि की जाती है, तो उसकी जिम्मेदारी ${onboardeeLabel} के साथ-साथ मेरी भी होगी।`,
    `2. यदि ${onboardeeLabel} किसी भी कारण से कंपनी का बकाया, चार्जबैक, पेनल्टी, नुकसान या देय राशि जमा करने में असमर्थ रहता है, तो मैं (${creatorLabel}) उक्त राशि 15 (पंद्रह) दिनों के भीतर K.A. PAYBRIDGEX SOLUTION (OPC) PRIVATE LIMITED को बिना किसी आपत्ति के जमा कराऊँगा/कराऊँगी।`,
    "3. कंपनी द्वारा मांगे जाने पर मैं आवश्यक दस्तावेज़, जानकारी एवं जांच में पूर्ण सहयोग दूँगा/दूँगी।",
    `4. यदि मैं निर्धारित समय में राशि जमा नहीं करता/करती हूँ, तो कंपनी को मेरा ${creatorLabel} ID, Wallet Balance, Security Deposit, Commission अथवा अन्य देय राशि समायोजित (Adjust) करने तथा आवश्यक कानूनी कार्यवाही करने का पूर्ण अधिकार होगा।`,
    `5. मैं यह भी स्वीकार करता/करती हूँ कि कंपनी केवल सेवा प्रदाता (Service Provider) है तथा ${onboardeeLabel} की गतिविधियों के लिए अंतिम जिम्मेदारी ${creatorLabel} एवं ${onboardeeLabel} की होगी।`,
    "6. यह Undertaking मेरी स्वेच्छा से, बिना किसी दबाव के दी जा रही है और यह कंपनी के साथ मेरे व्यावसायिक संबंधों का अभिन्न हिस्सा होगी।",
  ];
  for (const c of clauses) b.paragraph(c, { indent: 10, gap: 5 });
  b.doc.y += 2;

  b.heading("Indemnity");
  b.paragraph(
    `मैं, ${creatorLabel}, यह वचन देता/देती हूँ कि ${onboardeeLabel} की किसी भी गतिविधि से K.A. PAYBRIDGEX SOLUTION (OPC) PRIVATE LIMITED को होने वाले वित्तीय नुकसान, चार्जबैक, पेनल्टी, कानूनी खर्च अथवा अन्य किसी भी प्रकार की हानि की भरपाई करने के लिए उत्तरदायी रहूँगा/रहूँगी।`
  );
  b.doc.y += 6;

  b.sectionBar(`${creatorLabel} Signature`);
  b.signatureBlock(data.creatorName, evidence);
  if (evidence) b.approvalEvidenceBlock(evidence);

  b.companyUseOnly();

  return b.finish(DISCLAIMER);
}
