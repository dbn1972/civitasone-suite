-- Migration: 0023_routing_rules.sql
-- Purpose: Create helpdesk.routing_rules table for configurable ticket routing
-- Rollback: DROP TABLE IF EXISTS helpdesk.routing_rules;
-- Affected services: helpdesk-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS helpdesk.routing_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  name          varchar(255) NOT NULL,
  strategy      varchar(24) NOT NULL CHECK (strategy IN ('round_robin', 'weighted', 'skill_based', 'least_busy')),
  criteria      jsonb,
  weight        int NOT NULL DEFAULT 1,
  enabled       boolean NOT NULL DEFAULT true,
  ordinal       int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  version       int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_routing_rules_tenant_enabled
  ON helpdesk.routing_rules (tenant_id, enabled)
  WHERE enabled = true;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_routing_rules_tenant_ordinal
  ON helpdesk.routing_rules (tenant_id, ordinal);

-- RLS
ALTER TABLE helpdesk.routing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.routing_rules FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'routing_rules' AND policyname = 'routing_rules_tenant_isolation'
  ) THEN
    CREATE POLICY routing_rules_tenant_isolation ON helpdesk.routing_rules
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON helpdesk.routing_rules TO helpdesk_svc;
