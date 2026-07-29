-- Per-company (brand) T+1 settlement cutoff. A capture taken at/after this IST
-- hour (0-23) rolls into the next business day, so it settles on T+2 instead of
-- T+1. NULL = no early cutoff: the whole calendar day settles next-day (legacy
-- / platform-default behaviour).
ALTER TABLE "Brand" ADD COLUMN "t1CutoffHour" INTEGER;
