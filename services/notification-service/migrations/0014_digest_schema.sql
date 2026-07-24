-- Purpose: Add digest rules and accumulation buckets for notification batching
-- Rollback: DROP SCHEMA digest CASCADE;
-- Affected services: notification-service (digest module, digest flush sweeper)
SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS digest;

CREATE TABLE IF NOT EXISTS digest.digest_rules (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid NOT NULL,
  event_type                  varchar(128) NOT NULL,
  channel                     varchar(32) NOT NULL,
  accumulation_window_minutes integer NOT NULL,
  max_batch_size              integer NOT NULL DEFAULT 50,
  digest_template_id          uuid NOT NULL,
  enabled                     boolean NOT NULL DEFAULT true,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid NOT NULL,
  updated_by                  uuid NOT NULL,
  version                     integer NOT NULL DEFAULT 1,
  CONSTRAINT chk_window_range CHECK (
    accumulation_window_minutes >= 5 AND accumulation_window_minutes <= 1440
  )
);

CREATE TABLE IF NOT EXISTS digest.digest_buckets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  rule_id        uuid NOT NULL REFERENCES digest.digest_rules(id),
  recipient      varchar(254) NOT NULL,
  recipient_id   uuid,
  channel        varchar(32) NOT NULL,
  items          jsonb NOT NULL DEFAULT '[]',
  item_count     integer NOT NULL DEFAULT 0,
  opened_at      timestamptz NOT NULL DEFAULT now(),
  status         varchar(24) NOT NULL DEFAULT 'accumulating',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  updated_by     uuid NOT NULL,
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT chk_bucket_status CHECK (status IN ('accumulating', 'flushed', 'cancelled'))
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_digest_bucket_due
  ON digest.digest_buckets (opened_at)
  WHERE status = 'accumulating';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_digest_rules_lookup
  ON digest.digest_rules (tenant_id, event_type, channel)
  WHERE enabled = true;

-- Enable RLS for tenant isolation
ALTER TABLE digest.digest_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS digest_rules_tenant_isolation
  ON digest.digest_rules
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE digest.digest_buckets ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS digest_buckets_tenant_isolation
  ON digest.digest_buckets
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
