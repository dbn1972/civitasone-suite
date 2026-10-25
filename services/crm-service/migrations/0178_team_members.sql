-- Purpose: team membership for CRM team-based visibility. A crm_user sees records owned by
--   themselves (as before) AND records owned by any member of a team they belong to.
--   crm.teams (0022) had no membership at all, so there was no team model to reuse
--   (hrms reporting lines / identity groups are not reachable from crm-service).
-- Rollback: DROP TABLE IF EXISTS crm.team_members;
-- Affected services: crm-service (teams module; contacts, deals, accounts, activities reads)
-- Sequencing: additive. With no rows a user is in no team and sees only their own records.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  team_id uuid NOT NULL REFERENCES crm.teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  added_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT uq_team_members_team_user UNIQUE (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_tenant_user ON crm.team_members(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_team_members_team ON crm.team_members(team_id);

-- The table is new and empty so NO FORCE / FORCE is a no-op here; kept so the wrap is
-- uniform with the service's other RLS migrations.
ALTER TABLE crm.team_members NO FORCE ROW LEVEL SECURITY;
ALTER TABLE crm.team_members ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'team_members_tenant_isolation' AND tablename = 'team_members'
  ) THEN
    CREATE POLICY team_members_tenant_isolation ON crm.team_members
      USING (tenant_id::text = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

ALTER TABLE crm.team_members FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.team_members TO crm_svc;
  END IF;
END $$;
