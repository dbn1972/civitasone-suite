-- Migration: 0026_routing_failures.sql
-- Purpose: Create helpdesk.routing_failures table for routing failure diagnostics
-- Rollback: DROP TABLE IF EXISTS helpdesk.routing_failures;
-- Affected services: helpdesk-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS helpdesk.routing_failures (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  ticket_id         uuid NOT NULL,
  attempted_rule_id uuid,
  failure_reason    text NOT NULL,
  attempted_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_routing_failures_tenant_at
  ON helpdesk.routing_failures (tenant_id, attempted_at DESC);

-- RLS
ALTER TABLE helpdesk.routing_failures ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.routing_failures FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'routing_failures' AND policyname = 'routing_failures_tenant_isolation'
  ) THEN
    CREATE POLICY routing_failures_tenant_isolation ON helpdesk.routing_failures
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

GRANT SELECT, INSERT ON helpdesk.routing_failures TO helpdesk_svc;
