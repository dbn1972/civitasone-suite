-- RLS completeness: upgrade USING-only policies to USING + WITH CHECK
-- Purpose: Add WITH CHECK clause for INSERT enforcement on 8 project tables
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy ON each table; recreate with USING-only.

SET lock_timeout = '5s';

-- project.project_baselines
ALTER TABLE project.project_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE project.project_baselines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON project.project_baselines;
DROP POLICY IF EXISTS tenant_isolation ON project.project_baselines;
CREATE POLICY tenant_isolation_policy ON project.project_baselines
  USING (tenant_id = project.current_tenant_id())
  WITH CHECK (tenant_id = project.current_tenant_id());

-- project.project_evm
ALTER TABLE project.project_evm ENABLE ROW LEVEL SECURITY;
ALTER TABLE project.project_evm FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON project.project_evm;
DROP POLICY IF EXISTS tenant_isolation ON project.project_evm;
CREATE POLICY tenant_isolation_policy ON project.project_evm
  USING (tenant_id = project.current_tenant_id())
  WITH CHECK (tenant_id = project.current_tenant_id());

-- project.project_penalties
ALTER TABLE project.project_penalties ENABLE ROW LEVEL SECURITY;
ALTER TABLE project.project_penalties FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON project.project_penalties;
DROP POLICY IF EXISTS tenant_isolation ON project.project_penalties;
CREATE POLICY tenant_isolation_policy ON project.project_penalties
  USING (tenant_id = project.current_tenant_id())
  WITH CHECK (tenant_id = project.current_tenant_id());

-- project.project_ra_bills
ALTER TABLE project.project_ra_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE project.project_ra_bills FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON project.project_ra_bills;
DROP POLICY IF EXISTS tenant_isolation ON project.project_ra_bills;
CREATE POLICY tenant_isolation_policy ON project.project_ra_bills
  USING (tenant_id = project.current_tenant_id())
  WITH CHECK (tenant_id = project.current_tenant_id());

-- project.project_resources
ALTER TABLE project.project_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE project.project_resources FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON project.project_resources;
DROP POLICY IF EXISTS tenant_isolation ON project.project_resources;
CREATE POLICY tenant_isolation_policy ON project.project_resources
  USING (tenant_id = project.current_tenant_id())
  WITH CHECK (tenant_id = project.current_tenant_id());

-- project.project_risks
ALTER TABLE project.project_risks ENABLE ROW LEVEL SECURITY;
ALTER TABLE project.project_risks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON project.project_risks;
DROP POLICY IF EXISTS tenant_isolation ON project.project_risks;
CREATE POLICY tenant_isolation_policy ON project.project_risks
  USING (tenant_id = project.current_tenant_id())
  WITH CHECK (tenant_id = project.current_tenant_id());

-- project.project_scheme_dashboard
ALTER TABLE project.project_scheme_dashboard ENABLE ROW LEVEL SECURITY;
ALTER TABLE project.project_scheme_dashboard FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON project.project_scheme_dashboard;
DROP POLICY IF EXISTS tenant_isolation ON project.project_scheme_dashboard;
CREATE POLICY tenant_isolation_policy ON project.project_scheme_dashboard
  USING (tenant_id = project.current_tenant_id())
  WITH CHECK (tenant_id = project.current_tenant_id());

-- project.project_time_extensions
ALTER TABLE project.project_time_extensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE project.project_time_extensions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON project.project_time_extensions;
DROP POLICY IF EXISTS tenant_isolation ON project.project_time_extensions;
CREATE POLICY tenant_isolation_policy ON project.project_time_extensions
  USING (tenant_id = project.current_tenant_id())
  WITH CHECK (tenant_id = project.current_tenant_id());
