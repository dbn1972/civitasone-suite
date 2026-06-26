-- project-service RLS migration: tenant isolation backstop
-- Role: project_svc on civitas_project
-- Applied AFTER 0007_world_class_integrity.sql

CREATE OR REPLACE FUNCTION project.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT current_setting('app.tenant_id', false)::uuid
$$;

-- project schema
ALTER TABLE project.project_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project.project_projects FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON project.project_projects;
CREATE POLICY tenant_isolation ON project.project_projects USING (tenant_id = project.current_tenant_id());

ALTER TABLE project.project_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE project.project_tasks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON project.project_tasks;
CREATE POLICY tenant_isolation ON project.project_tasks USING (tenant_id = project.current_tenant_id());

ALTER TABLE project.project_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE project.project_milestones FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON project.project_milestones;
CREATE POLICY tenant_isolation ON project.project_milestones USING (tenant_id = project.current_tenant_id());

ALTER TABLE project.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE project.project_members FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON project.project_members;
CREATE POLICY tenant_isolation ON project.project_members USING (tenant_id = project.current_tenant_id());

ALTER TABLE project.milestone_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE project.milestone_evidence FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON project.milestone_evidence;
CREATE POLICY tenant_isolation ON project.milestone_evidence USING (tenant_id = project.current_tenant_id());

ALTER TABLE project.project_scheme_dashboard ENABLE ROW LEVEL SECURITY;
ALTER TABLE project.project_scheme_dashboard FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON project.project_scheme_dashboard;
CREATE POLICY tenant_isolation ON project.project_scheme_dashboard USING (tenant_id = project.current_tenant_id());

ALTER TABLE project.project_risks ENABLE ROW LEVEL SECURITY;
ALTER TABLE project.project_risks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON project.project_risks;
CREATE POLICY tenant_isolation ON project.project_risks USING (tenant_id = project.current_tenant_id());

ALTER TABLE project.project_evm ENABLE ROW LEVEL SECURITY;
ALTER TABLE project.project_evm FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON project.project_evm;
CREATE POLICY tenant_isolation ON project.project_evm USING (tenant_id = project.current_tenant_id());

ALTER TABLE project.project_ra_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE project.project_ra_bills FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON project.project_ra_bills;
CREATE POLICY tenant_isolation ON project.project_ra_bills USING (tenant_id = project.current_tenant_id());

ALTER TABLE project.project_time_extensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE project.project_time_extensions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON project.project_time_extensions;
CREATE POLICY tenant_isolation ON project.project_time_extensions USING (tenant_id = project.current_tenant_id());

ALTER TABLE project.project_penalties ENABLE ROW LEVEL SECURITY;
ALTER TABLE project.project_penalties FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON project.project_penalties;
CREATE POLICY tenant_isolation ON project.project_penalties USING (tenant_id = project.current_tenant_id());

ALTER TABLE project.project_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE project.project_resources FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON project.project_resources;
CREATE POLICY tenant_isolation ON project.project_resources USING (tenant_id = project.current_tenant_id());

ALTER TABLE project.project_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE project.project_baselines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON project.project_baselines;
CREATE POLICY tenant_isolation ON project.project_baselines USING (tenant_id = project.current_tenant_id());

-- scheme schema
ALTER TABLE scheme.project_schemes ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheme.project_schemes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON scheme.project_schemes;
CREATE POLICY tenant_isolation ON scheme.project_schemes USING (tenant_id = project.current_tenant_id());

ALTER TABLE scheme.project_scheme_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheme.project_scheme_components FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON scheme.project_scheme_components;
CREATE POLICY tenant_isolation ON scheme.project_scheme_components USING (tenant_id = project.current_tenant_id());

ALTER TABLE scheme.project_fund_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheme.project_fund_releases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON scheme.project_fund_releases;
CREATE POLICY tenant_isolation ON scheme.project_fund_releases USING (tenant_id = project.current_tenant_id());

-- progress schema
ALTER TABLE progress.project_physical_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress.project_physical_progress FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON progress.project_physical_progress;
CREATE POLICY tenant_isolation ON progress.project_physical_progress USING (tenant_id = project.current_tenant_id());

ALTER TABLE progress.project_financial_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress.project_financial_progress FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON progress.project_financial_progress;
CREATE POLICY tenant_isolation ON progress.project_financial_progress USING (tenant_id = project.current_tenant_id());

ALTER TABLE progress.project_dprs ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress.project_dprs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON progress.project_dprs;
CREATE POLICY tenant_isolation ON progress.project_dprs USING (tenant_id = project.current_tenant_id());

-- utilisation schema
ALTER TABLE utilisation.project_uc_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE utilisation.project_uc_statements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON utilisation.project_uc_statements;
CREATE POLICY tenant_isolation ON utilisation.project_uc_statements USING (tenant_id = project.current_tenant_id());

ALTER TABLE utilisation.project_uc_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE utilisation.project_uc_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON utilisation.project_uc_items;
CREATE POLICY tenant_isolation ON utilisation.project_uc_items USING (tenant_id = project.current_tenant_id());

-- geo schema
ALTER TABLE geo.project_geo_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE geo.project_geo_tags FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON geo.project_geo_tags;
CREATE POLICY tenant_isolation ON geo.project_geo_tags USING (tenant_id = project.current_tenant_id());

ALTER TABLE geo.project_site_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE geo.project_site_photos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON geo.project_site_photos;
CREATE POLICY tenant_isolation ON geo.project_site_photos USING (tenant_id = project.current_tenant_id());

-- outbox
ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages;
CREATE POLICY tenant_isolation ON _outbox.messages USING (tenant_id = project.current_tenant_id());
