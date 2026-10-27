-- revenue-service: server-issued, single-use BBPS bill tokens
-- Purpose: Owner decision #7 (2026-10-26, GAP-REVENUE-BBPS-01). fetch-bill issues
--          an unguessable token bound to (tenant, assessee, amount) with a short
--          expiry; pay-bill takes ONLY that token and derives assessee + amount
--          from it, so a typed or invented amount can never be credited. The token
--          is consumed exactly once (bill_consumed_at, claimed with a guarded
--          UPDATE in the pay transaction).
-- Rollback: DROP INDEX bbps.uq_bbps_transactions_bill_token;
--           ALTER TABLE bbps.bbps_transactions DROP COLUMN bill_token, DROP COLUMN bill_expires_at, DROP COLUMN bill_consumed_at;
-- Affected services: revenue-service
-- RLS: bbps.bbps_transactions already has tenant-isolation RLS (0002); adding columns does not change it.

SET lock_timeout = '5s';

ALTER TABLE bbps.bbps_transactions
  ADD COLUMN IF NOT EXISTS bill_token       varchar(64),
  ADD COLUMN IF NOT EXISTS bill_expires_at  timestamptz,
  ADD COLUMN IF NOT EXISTS bill_consumed_at timestamptz;

DO $$ BEGIN
  CREATE UNIQUE INDEX uq_bbps_transactions_bill_token
    ON bbps.bbps_transactions (tenant_id, bill_token)
    WHERE bill_token IS NOT NULL;
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;
