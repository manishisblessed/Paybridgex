-- Admin activity control + TPIN login.
-- Additive-only migration (no destructive changes).

-- ── User: TPIN-login / 2FA-exempt fields ────────────────────────────────────
ALTER TABLE "User"
  ADD COLUMN     "twoFactorExempt" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN     "pinLoginEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN     "pinLoginRiskAcceptedAt" TIMESTAMP(3),
  ADD COLUMN     "pinLoginRiskAcceptedIp" TEXT;

-- ── QrClaim: structured multi-select rejection reasons ──────────────────────
ALTER TABLE "QrClaim"
  ADD COLUMN     "rejectionReasons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- ── AuditLog: actor + geo snapshot columns ──────────────────────────────────
ALTER TABLE "AuditLog"
  ADD COLUMN     "actorName" TEXT,
  ADD COLUMN     "actorRole" TEXT,
  ADD COLUMN     "lat" DOUBLE PRECISION,
  ADD COLUMN     "lng" DOUBLE PRECISION,
  ADD COLUMN     "locationAccuracy" DOUBLE PRECISION,
  ADD COLUMN     "kind" TEXT;

CREATE INDEX "AuditLog_actorRole_createdAt_idx" ON "AuditLog"("actorRole", "createdAt");
