import { describe, expect, it } from "vitest";
import { splitMdrGst } from "@/lib/mdr/gst";
import { dec, toFixedString } from "@/lib/money";

describe("MDR margin GST split (acquiring rails: POS/PG/QR)", () => {
  it("inclusive: carves 18% GST out of the margin (base = margin ÷ 1.18)", () => {
    // ₹118 GST-inclusive margin → ₹100 revenue + ₹18 GST
    const { gst, marginExGst } = splitMdrGst(dec("118.00"), true);
    expect(toFixedString(marginExGst)).toBe("100.00");
    expect(toFixedString(gst)).toBe("18.00");
  });

  it("inclusive: gst + marginExGst === margin exactly (no lost paise)", () => {
    for (const m of ["1.00", "0.05", "999.99", "12345.67", "3.33"]) {
      const { gst, marginExGst } = splitMdrGst(dec(m), true);
      expect(toFixedString(gst.add(marginExGst))).toBe(toFixedString(dec(m)));
    }
  });

  it("on-top: full margin stays revenue and 18% GST is added", () => {
    const { gst, marginExGst } = splitMdrGst(dec("100.00"), false);
    expect(toFixedString(marginExGst)).toBe("100.00");
    expect(toFixedString(gst)).toBe("18.00");
  });

  it("zero / negative margin yields zero GST and zero revenue", () => {
    for (const flag of [true, false]) {
      const zero = splitMdrGst(dec("0"), flag);
      expect(toFixedString(zero.gst)).toBe("0.00");
      expect(toFixedString(zero.marginExGst)).toBe("0.00");
      const neg = splitMdrGst(dec("-5"), flag);
      expect(toFixedString(neg.gst)).toBe("0.00");
      expect(toFixedString(neg.marginExGst)).toBe("0.00");
    }
  });
});
