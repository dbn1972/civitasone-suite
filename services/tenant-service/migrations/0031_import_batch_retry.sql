-- 0031_import_batch_retry.sql
-- OWNER DECISION #23 (TENANT-DATA-MIGRATION-01): a failed import can be retried
-- for its FAILED records only, and its error report is downloadable as CSV
-- (row, field, error). To retry only the failures the batch must remember them:
--   failed_records : [{ index, record }] -- the original payload of each record that did not load
--   retry_count / last_retry_at / last_retry_by : who retried and when (the audit event carries the rest)
-- Additive and idempotent. RLS on tenant.import_batches is unchanged.
SET lock_timeout = '5s';

ALTER TABLE tenant.import_batches
  ADD COLUMN IF NOT EXISTS failed_records jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS retry_count    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_retry_at  timestamptz,
  ADD COLUMN IF NOT EXISTS last_retry_by  uuid;
