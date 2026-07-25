-- CAP-094 Feature flags — add expiry + ownership.
--   Additive columns on feature_flags.feature_flags so a flag can carry an
--   expiry (auto-off past the date) and an accountable owner. Idempotent.
-- Rollback: ALTER TABLE feature_flags.feature_flags DROP COLUMN expires_at, DROP COLUMN owner;
-- Affected services: admin-service

SET lock_timeout = '5s';

ALTER TABLE feature_flags.feature_flags
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE feature_flags.feature_flags
  ADD COLUMN IF NOT EXISTS owner varchar(160) NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS feature_flags_tenant_expires_idx
  ON feature_flags.feature_flags (tenant_id, expires_at);
