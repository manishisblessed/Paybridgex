-- Add a GST-treatment flag to the rail rate card (service rails: BBPS/Payout).
-- When true, the entered vendor cost (mdrValue) and minimum charge (minMdrValue)
-- already include 18% GST, so the ex-GST cost is value/1.18 and company revenue
-- = customer charge (ex-GST) − ex-GST vendor cost. When false (default) the
-- entered values are already ex-GST. Ignored for PG/QR rows (kept default false).

ALTER TABLE "RailMdrRate"
    ADD COLUMN "gstInclusive" BOOLEAN NOT NULL DEFAULT false;
