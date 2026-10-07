import { Prisma } from "@prisma/client";

/**
 * Money helpers — all monetary math MUST go through Decimal, never JS floats.
 *
 * Why: JavaScript numbers are IEEE-754 doubles. `0.1 + 0.2 !== 0.3`, and large
 * rupee values lose precision. In a finance ledger that means money silently
 * appears or disappears. `Prisma.Decimal` (decimal.js) is exact.
 *
 * Rule of thumb: take Decimal | string | number as input at the boundary,
 * convert once with `dec()`, and keep everything Decimal until the final
 * serialization step.
 */

export type Money = Prisma.Decimal;

/** Number of decimal places we persist (matches @db.Decimal(14, 2)). */
export const MONEY_SCALE = 2;

/**
 * Standard output GST rate (%) on every taxable supply on the platform (service
 * fees + payout charges). Stamped onto each row's `gstRate` at charge time so
 * the GST report groups by the authoritative slab rather than re-deriving it
 * from gst÷taxable (which drifts on sub-rupee paise rounding).
 */
export const GST_RATE_PCT = 18;

/** Coerce any supported input into an exact Decimal. */
export function dec(value: Prisma.Decimal | string | number): Prisma.Decimal {
  if (value instanceof Prisma.Decimal) return value;
  // Stringify numbers to avoid passing an already-lossy float into Decimal.
  return new Prisma.Decimal(typeof value === "number" ? value.toString() : value);
}

export function add(a: Money | string | number, b: Money | string | number): Money {
  return dec(a).add(dec(b));
}

export function sub(a: Money | string | number, b: Money | string | number): Money {
  return dec(a).sub(dec(b));
}

export function mul(a: Money | string | number, b: Money | string | number): Money {
  return dec(a).mul(dec(b));
}

/** Round to money scale using banker-safe half-up rounding. */
export function round(a: Money | string | number): Money {
  return dec(a).toDecimalPlaces(MONEY_SCALE, Prisma.Decimal.ROUND_HALF_UP);
}

export function gte(a: Money | string | number, b: Money | string | number): boolean {
  return dec(a).gte(dec(b));
}

export function gt(a: Money | string | number, b: Money | string | number): boolean {
  return dec(a).gt(dec(b));
}

export function lte(a: Money | string | number, b: Money | string | number): boolean {
  return dec(a).lte(dec(b));
}

export function lt(a: Money | string | number, b: Money | string | number): boolean {
  return dec(a).lt(dec(b));
}

export function eq(a: Money | string | number, b: Money | string | number): boolean {
  return dec(a).eq(dec(b));
}

export function isPositive(a: Money | string | number): boolean {
  return dec(a).gt(0);
}

/** Percentage helper: `percentOf(100, 18)` => 18.00 */
export function percentOf(
  base: Money | string | number,
  percent: Money | string | number
): Money {
  return round(mul(dec(base), dec(percent).div(100)));
}

/** Final serialization to a JS number — only at the API/JSON boundary. */
export function toNumber(a: Money | string | number): number {
  return dec(a).toNumber();
}

/** Serialize to a fixed 2dp string, e.g. for display or exact transport. */
export function toFixedString(a: Money | string | number): string {
  return round(a).toFixed(MONEY_SCALE);
}
