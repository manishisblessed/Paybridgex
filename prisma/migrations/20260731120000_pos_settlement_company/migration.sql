-- Add the acquiring-company dimension to POS settlement entries.
--
-- MDR slabs may be pinned per acquiring company (PosMachine.company, e.g.
-- "Sameday-AXIS"). The capture engine now resolves the machine's company and
-- prices against it; persisting it here lets the T+1 sweep and instant
-- re-pricing resolve the SAME slab the capture was originally quoted at.
-- Nullable so existing rows (priced as wildcard) remain valid.

ALTER TABLE "PosSettlementEntry" ADD COLUMN "company" TEXT;
