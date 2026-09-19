-- Add per-slab GST treatment for acquiring rails (POS/PG/QR).
-- Default TRUE: the company MDR margin is treated as GST-inclusive @18%, so the
-- ex-GST margin is booked as revenue and the balance is a GST pass-through
-- liability recorded on the settlement Transaction.
ALTER TABLE "MdrSlab" ADD COLUMN "mdrGstInclusive" BOOLEAN NOT NULL DEFAULT true;
