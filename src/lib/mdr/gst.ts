/**
 * Pure GST arithmetic for the acquiring (MDR) rails — no DB/Prisma-client
 * imports, so it is unit-testable in isolation. All money math goes through the
 * Decimal helpers (never JS floats).
 */
import { dec, mul, round, sub, type Money } from "@/lib/money";

/** Standard GST rate applied to the acquiring (MDR) margin. */
export const MDR_GST_RATE = dec("0.18");
/** 1 + rate — divisor to strip GST from a GST-inclusive margin. */
export const MDR_GST_DIVISOR = dec("1.18");

/**
 * Split an MDR margin into its ex-GST revenue and GST liability per the slab's
 * `mdrGstInclusive` flag. Inclusive → carve 18% out (base = margin ÷ 1.18);
 * otherwise → 18% on top (full margin is revenue). For the inclusive case
 * `gst + marginExGst === margin` always holds (no lost/created paise).
 */
export function splitMdrGst(
  margin: Money,
  gstInclusive: boolean
): { gst: Money; marginExGst: Money } {
  if (!margin.gt(0)) return { gst: dec(0), marginExGst: dec(0) };
  if (gstInclusive) {
    const marginExGst = round(margin.div(MDR_GST_DIVISOR));
    return { gst: round(sub(margin, marginExGst)), marginExGst };
  }
  return { gst: round(mul(margin, MDR_GST_RATE)), marginExGst: margin };
}
