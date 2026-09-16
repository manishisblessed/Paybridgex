-- User: preferred second factor when both an authenticator app and TPIN login
-- are available. "authenticator" | "tpin" | NULL (NULL = ask every time).
-- Additive-only, nullable column — safe to apply online.
ALTER TABLE "User"
  ADD COLUMN     "preferredLoginMethod" TEXT;
