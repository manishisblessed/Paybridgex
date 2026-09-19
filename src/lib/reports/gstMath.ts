/**
 * Pure GST arithmetic for the GST report — no DB or Prisma-client imports, so it
 * can be unit-tested in isolation. All money math goes through the Decimal
 * helpers (never JS floats).
 */
import { Prisma } from "@prisma/client";
import { dec, sub, round } from "@/lib/money";

/** Whole-number GST rate from tax ÷ taxable (18 for the standard 18% slab). */
export function gstRate(gst: Prisma.Decimal, taxable: Prisma.Decimal): number {
  if (!taxable.gt(0)) return 0;
  return Math.round(gst.div(taxable).mul(100).toNumber());
}

/**
 * Split a GST amount into the intra-state CGST / SGST halves. CGST is rounded to
 * money scale and SGST takes the remainder, so `cgst + sgst === gst` exactly and
 * no paise is created or lost on odd amounts.
 */
export function splitCgstSgst(
  gst: Prisma.Decimal | number | string
): { cgst: Prisma.Decimal; sgst: Prisma.Decimal } {
  const g = dec(gst);
  const cgst = round(g.div(2));
  return { cgst, sgst: sub(g, cgst) };
}
