-- Purpose: Create teams and lead_queues tables (AS-002).
-- Rollback: DROP TABLE IF EXISTS crm.lead_queues; DROP TABLE IF EXISTS crm.teams;
-- Affected services: crm-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name varchar(200) NOT NULL,
  territory jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_teams_tenant_id ON crm.teams(tenant_id);

ALTER TABLE crm.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.teams FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'teams_tenant_isolation' AND tablename = 'teams'
  ) THEN
    CREATE POLICY teams_tenant_isolation ON crm.teams
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS crm.lead_queues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  team_id uuid NOT NULL REFERENCES crm.teams(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL,
  priority integer NOT NULL DEFAULT 0,
  entered_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lead_queues_tenant_id ON crm.lead_queues(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lead_queues_team_id ON crm.lead_queues(team_id);

ALTER TABLE crm.lead_queues ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.lead_queues FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'lead_queues_tenant_isolation' AND tablename = 'lead_queues'
  ) THEN
    CREATE POLICY lead_queues_tenant_isolation ON crm.lead_queues
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.teams TO crm_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.lead_queues TO crm_svc;
  END IF;
END $$;
