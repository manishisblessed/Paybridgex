-- POS becomes a first-class ServiceCode so POS acquirer settlements attribute
-- their earnings and commission per-service (previously booked against a
-- WALLET_TOPUP placeholder on the synthetic settlement transaction, which made
-- the revenue "by service" breakdown misattribute POS). Additive and safe to
-- apply while the app is running; existing rows are untouched.

ALTER TYPE "ServiceCode" ADD VALUE IF NOT EXISTS 'POS';
