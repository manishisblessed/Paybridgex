import { describe, expect, it } from "vitest";
import { gstRate, splitCgstSgst } from "@/lib/reports/gstMath";
import { dec, toFixedString } from "@/lib/money";

describe("GST report — rate derivation", () => {
  it("derives 18% for GST-inclusive service fees (taxable = fee − gst)", () => {
    // fee ₹118 incl. GST → taxable ₹100, gst ₹18
    expect(gstRate(dec(18), dec(100))).toBe(18);
  });

  it("derives 18% for payout charges (ex-GST base + separate gst)", () => {
    // serviceCharge ₹10, gst ₹1.80
    expect(gstRate(dec("1.80"), dec("10.00"))).toBe(18);
  });

  it("rounds the rate to a whole number on odd paise", () => {
    // ₹3.00 charge → ₹0.54 gst = 18%
    expect(gstRate(dec("0.54"), dec("3.00"))).toBe(18);
  });

  it("guards divide-by-zero: zero taxable → rate 0", () => {
    expect(gstRate(dec(5), dec(0))).toBe(0);
    expect(gstRate(dec(0), dec(0))).toBe(0);
  });
});

describe("GST report — CGST/SGST split", () => {
  it("splits an even amount into equal halves", () => {
    const { cgst, sgst } = splitCgstSgst("1.80");
    expect(toFixedString(cgst)).toBe("0.90");
    expect(toFixedString(sgst)).toBe("0.90");
  });

  it("keeps cgst + sgst === gst exactly on odd paise (no lost/created paise)", () => {
    for (const g of ["0.45", "0.01", "1.81", "123.45", "0.03"]) {
      const { cgst, sgst } = splitCgstSgst(g);
      expect(toFixedString(cgst.add(sgst))).toBe(toFixedString(dec(g)));
    }
  });

  it("accepts number and Decimal inputs", () => {
    const fromNum = splitCgstSgst(18);
    expect(toFixedString(fromNum.cgst.add(fromNum.sgst))).toBe("18.00");
    const fromDec = splitCgstSgst(dec("18.00"));
    expect(toFixedString(fromDec.cgst)).toBe("9.00");
  });
});
