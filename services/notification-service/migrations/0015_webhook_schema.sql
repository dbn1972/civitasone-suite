-- Purpose: Add webhook endpoint configuration for webhook channel adapter
-- Rollback: DROP SCHEMA webhook CASCADE;
-- Affected services: notification-service (webhook module, webhook adapter)
SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS webhook;

CREATE TABLE IF NOT EXISTS webhook.endpoints (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  name        varchar(128) NOT NULL,
  url         text NOT NULL,
  secret      text NOT NULL,
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NOT NULL,
  updated_by  uuid NOT NULL,
  version     integer NOT NULL DEFAULT 1,
  CONSTRAINT chk_webhook_https CHECK (url LIKE 'https://%')
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webhook_tenant
  ON webhook.endpoints (tenant_id) WHERE enabled = true;

-- Enable RLS for tenant isolation
ALTER TABLE webhook.endpoints ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS webhook_tenant_isolation
  ON webhook.endpoints
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
