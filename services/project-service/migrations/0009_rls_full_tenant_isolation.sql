-- RLS completion: full tenant isolation (USING + WITH CHECK) for project-service
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy on each table, then DISABLE ROW LEVEL SECURITY

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION project.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- geo.project_geo_tags
ALTER TABLE geo.project_geo_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE geo.project_geo_tags FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON geo.project_geo_tags;
DROP POLICY IF EXISTS tenant_isolation ON geo.project_geo_tags;
CREATE POLICY tenant_isolation_policy ON geo.project_geo_tags
  USING (tenant_id = project.current_tenant_id())
  WITH CHECK (tenant_id = project.current_tenant_id());

-- geo.project_site_photos
ALTER TABLE geo.project_site_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE geo.project_site_photos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON geo.project_site_photos;
DROP POLICY IF EXISTS tenant_isolation ON geo.project_site_photos;
CREATE POLICY tenant_isolation_policy ON geo.project_site_photos
  USING (tenant_id = project.current_tenant_id())
  WITH CHECK (tenant_id = project.current_tenant_id());

-- progress.project_dprs
ALTER TABLE progress.project_dprs ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress.project_dprs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON progress.project_dprs;
DROP POLICY IF EXISTS tenant_isolation ON progress.project_dprs;
CREATE POLICY tenant_isolation_policy ON progress.project_dprs
  USING (tenant_id = project.current_tenant_id())
  WITH CHECK (tenant_id = project.current_tenant_id());

-- progress.project_financial_progress
ALTER TABLE progress.project_financial_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress.project_financial_progress FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON progress.project_financial_progress;
DROP POLICY IF EXISTS tenant_isolation ON progress.project_financial_progress;
CREATE POLICY tenant_isolation_policy ON progress.project_financial_progress
  USING (tenant_id = project.current_tenant_id())
  WITH CHECK (tenant_id = project.current_tenant_id());

-- progress.project_physical_progress
ALTER TABLE progress.project_physical_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress.project_physical_progress FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON progress.project_physical_progress;
DROP POLICY IF EXISTS tenant_isolation ON progress.project_physical_progress;
CREATE POLICY tenant_isolation_policy ON progress.project_physical_progress
  USING (tenant_id = project.current_tenant_id())
  WITH CHECK (tenant_id = project.current_tenant_id());

-- project.milestone_evidence
ALTER TABLE project.milestone_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE project.milestone_evidence FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON project.milestone_evidence;
DROP POLICY IF EXISTS tenant_isolation ON project.milestone_evidence;
CREATE POLICY tenant_isolation_policy ON project.milestone_evidence
  USING (tenant_id = project.current_tenant_id())
  WITH CHECK (tenant_id = project.current_tenant_id());

-- project.project_members
ALTER TABLE project.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE project.project_members FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON project.project_members;
DROP POLICY IF EXISTS tenant_isolation ON project.project_members;
CREATE POLICY tenant_isolation_policy ON project.project_members
  USING (tenant_id = project.current_tenant_id())
  WITH CHECK (tenant_id = project.current_tenant_id());

-- project.project_milestones
ALTER TABLE project.project_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE project.project_milestones FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON project.project_milestones;
DROP POLICY IF EXISTS tenant_isolation ON project.project_milestones;
CREATE POLICY tenant_isolation_policy ON project.project_milestones
  USING (tenant_id = project.current_tenant_id())
  WITH CHECK (tenant_id = project.current_tenant_id());

-- project.project_projects
ALTER TABLE project.project_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project.project_projects FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON project.project_projects;
DROP POLICY IF EXISTS tenant_isolation ON project.project_projects;
CREATE POLICY tenant_isolation_policy ON project.project_projects
  USING (tenant_id = project.current_tenant_id())
  WITH CHECK (tenant_id = project.current_tenant_id());

-- project.project_tasks
ALTER TABLE project.project_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE project.project_tasks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON project.project_tasks;
DROP POLICY IF EXISTS tenant_isolation ON project.project_tasks;
CREATE POLICY tenant_isolation_policy ON project.project_tasks
  USING (tenant_id = project.current_tenant_id())
  WITH CHECK (tenant_id = project.current_tenant_id());

-- scheme.project_fund_releases
ALTER TABLE scheme.project_fund_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheme.project_fund_releases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON scheme.project_fund_releases;
DROP POLICY IF EXISTS tenant_isolation ON scheme.project_fund_releases;
CREATE POLICY tenant_isolation_policy ON scheme.project_fund_releases
  USING (tenant_id = project.current_tenant_id())
  WITH CHECK (tenant_id = project.current_tenant_id());

-- scheme.project_scheme_components
ALTER TABLE scheme.project_scheme_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheme.project_scheme_components FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON scheme.project_scheme_components;
DROP POLICY IF EXISTS tenant_isolation ON scheme.project_scheme_components;
CREATE POLICY tenant_isolation_policy ON scheme.project_scheme_components
  USING (tenant_id = project.current_tenant_id())
  WITH CHECK (tenant_id = project.current_tenant_id());

-- scheme.project_schemes
ALTER TABLE scheme.project_schemes ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheme.project_schemes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON scheme.project_schemes;
DROP POLICY IF EXISTS tenant_isolation ON scheme.project_schemes;
CREATE POLICY tenant_isolation_policy ON scheme.project_schemes
  USING (tenant_id = project.current_tenant_id())
  WITH CHECK (tenant_id = project.current_tenant_id());

-- utilisation.project_uc_items
ALTER TABLE utilisation.project_uc_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE utilisation.project_uc_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON utilisation.project_uc_items;
DROP POLICY IF EXISTS tenant_isolation ON utilisation.project_uc_items;
CREATE POLICY tenant_isolation_policy ON utilisation.project_uc_items
  USING (tenant_id = project.current_tenant_id())
  WITH CHECK (tenant_id = project.current_tenant_id());

-- utilisation.project_uc_statements
ALTER TABLE utilisation.project_uc_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE utilisation.project_uc_statements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON utilisation.project_uc_statements;
DROP POLICY IF EXISTS tenant_isolation ON utilisation.project_uc_statements;
CREATE POLICY tenant_isolation_policy ON utilisation.project_uc_statements
  USING (tenant_id = project.current_tenant_id())
  WITH CHECK (tenant_id = project.current_tenant_id());

-- _outbox.messages (transactional outbox)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '_outbox' AND table_name = 'messages') THEN
    ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_policy ON _outbox.messages';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages';
    EXECUTE 'CREATE POLICY tenant_isolation_policy ON _outbox.messages
      USING (tenant_id = project.current_tenant_id())
      WITH CHECK (tenant_id = project.current_tenant_id())';
  END IF;
END $$;
