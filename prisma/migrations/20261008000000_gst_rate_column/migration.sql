-- Stamp the authoritative GST slab rate (%) onto each taxable supply at charge
-- time, so the rate-wise GST report groups by a stored rate instead of
-- re-deriving it from gst÷taxable (which drifts into phantom 20%/25% buckets on
-- sub-rupee charges, where the mandatory 1-paise GST rounding dominates a tiny
-- taxable base).

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "gstRate" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PayoutRequest" ADD COLUMN "gstRate" INTEGER NOT NULL DEFAULT 0;

-- Backfill: every GST ever charged on the platform was the standard 18% slab
-- (service fees and payout charges alike). Rows with no GST stay at 0.
UPDATE "Transaction" SET "gstRate" = 18 WHERE "gst" > 0;
UPDATE "PayoutRequest" SET "gstRate" = 18 WHERE "gst" > 0;
