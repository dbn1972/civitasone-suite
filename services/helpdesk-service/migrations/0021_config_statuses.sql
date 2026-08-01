-- Purpose: Create status_config table for status color and canonical state mapping (CFG-04)
-- Rollback: DROP TABLE IF EXISTS helpdesk.status_config;
-- Affected services: helpdesk-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS helpdesk.status_config (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  name            varchar(64) NOT NULL,
  color           varchar(7) NOT NULL,
  canonical_state varchar(24) NOT NULL CHECK (canonical_state IN ('open', 'pending', 'resolved', 'closed')),
  ordinal         integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  version         integer NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_status_config_tenant_id
  ON helpdesk.status_config (tenant_id);

-- RLS
ALTER TABLE helpdesk.status_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.status_config FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'status_config' AND policyname = 'status_config_tenant_isolation'
  ) THEN
    CREATE POLICY status_config_tenant_isolation ON helpdesk.status_config
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON helpdesk.status_config TO helpdesk_svc;
