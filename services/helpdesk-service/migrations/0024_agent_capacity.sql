-- Migration: 0024_agent_capacity.sql
-- Purpose: Create helpdesk.agent_capacity table for agent workload tracking
-- Rollback: DROP TABLE IF EXISTS helpdesk.agent_capacity;
-- Affected services: helpdesk-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS helpdesk.agent_capacity (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  agent_id      uuid NOT NULL,
  max_tickets   int NOT NULL DEFAULT 10,
  current_load  int NOT NULL DEFAULT 0,
  skills        jsonb DEFAULT '[]'::jsonb,
  available     boolean NOT NULL DEFAULT true,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  version       int NOT NULL DEFAULT 1,
  CONSTRAINT uq_agent_capacity_tenant_agent UNIQUE (tenant_id, agent_id)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_capacity_tenant_available
  ON helpdesk.agent_capacity (tenant_id, available)
  WHERE available = true;

-- RLS
ALTER TABLE helpdesk.agent_capacity ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.agent_capacity FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'agent_capacity' AND policyname = 'agent_capacity_tenant_isolation'
  ) THEN
    CREATE POLICY agent_capacity_tenant_isolation ON helpdesk.agent_capacity
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON helpdesk.agent_capacity TO helpdesk_svc;
