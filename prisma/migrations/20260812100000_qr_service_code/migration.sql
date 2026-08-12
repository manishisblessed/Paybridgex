-- QR becomes a first-class ServiceCode so static-QR collection settlements
-- attribute their revenue and commission per-service (previously booked against
-- a WALLET_TOPUP placeholder on the synthetic settlement transaction, which made
-- the revenue "by service" breakdown misattribute QR and hid the per-leg split).
-- Additive and safe to apply while the app is running; existing rows are
-- untouched. The new value is only USED by rows inserted/updated later (never
-- within this migration), so it is transaction-safe on modern PostgreSQL.

ALTER TYPE "ServiceCode" ADD VALUE IF NOT EXISTS 'QR';
