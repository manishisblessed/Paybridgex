-- Add Minimum MDR to the rail (PG/QR) rate card, mirroring BrandMdrRate for POS.
-- The company's guaranteed floor offered downstream; a scheme's QR/PG service
-- charge can never be priced below it, and the chain commission pool is
-- whatever the scheme prices above it (service − minMdr). Defaults to 0, which
-- the resolvers treat as "fall back to the vendor cost (mdrValue)".

ALTER TABLE "RailMdrRate"
    ADD COLUMN "minMdrValue" DECIMAL(14,4) NOT NULL DEFAULT 0,
    ADD COLUMN "minMdrValueT0" DECIMAL(14,4) NOT NULL DEFAULT 0;
