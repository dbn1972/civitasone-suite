-- revenue-service migration 0010 — GAP-REVENUE-WRITE-OFFS-03
-- Add an OPTIONAL demand reference (and its financial year) to a write-off so
-- the audit/decide trail can say WHICH year's demand a reduction applied to.
-- Additive and idempotent: both columns are NULLABLE, so existing rows need no
-- backfill (they predate the demand reference and legitimately have none).
-- These are NOT money-total columns, so the NOT-NULL-DEFAULT backfill rule does
-- not apply. No new grants: revenue_svc already has DML on arrears.write_offs.
--
-- Applied AFTER 0009_perf016_tenant_indexes.sql
-- Rollback:
--   ALTER TABLE arrears.write_offs DROP COLUMN IF EXISTS financial_year;
--   ALTER TABLE arrears.write_offs DROP COLUMN IF EXISTS demand_id;

SET lock_timeout = '5s';

ALTER TABLE arrears.write_offs
  ADD COLUMN IF NOT EXISTS demand_id uuid;

ALTER TABLE arrears.write_offs
  ADD COLUMN IF NOT EXISTS financial_year varchar(16);
