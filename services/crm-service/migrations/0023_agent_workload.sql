-- Purpose: Create agent_workload table for capacity management (AS-003).
-- Rollback: DROP TABLE IF EXISTS crm.agent_workload;
-- Affected services: crm-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.agent_workload (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  max_leads integer NOT NULL DEFAULT 50,
  current_load integer NOT NULL DEFAULT 0,
  available boolean NOT NULL DEFAULT true,
  skills jsonb NOT NULL DEFAULT '[]',
  version integer NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_workload_tenant_id ON crm.agent_workload(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_workload_agent_id ON crm.agent_workload(agent_id);

ALTER TABLE crm.agent_workload ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.agent_workload FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'agent_workload_tenant_isolation' AND tablename = 'agent_workload'
  ) THEN
    CREATE POLICY agent_workload_tenant_isolation ON crm.agent_workload
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.agent_workload TO crm_svc;
  END IF;
END $$;
