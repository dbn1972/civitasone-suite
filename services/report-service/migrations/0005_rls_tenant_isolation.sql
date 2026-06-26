-- Additive, idempotent. Safe to re-run.
-- Enables Row Level Security on all tables with a tenant_id column.

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- reports.jobs
ALTER TABLE reports.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports.jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON reports.jobs;
CREATE POLICY tenant_isolation ON reports.jobs
  USING (tenant_id = current_tenant_id());

-- reports.kpis
ALTER TABLE reports.kpis ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports.kpis FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON reports.kpis;
CREATE POLICY tenant_isolation ON reports.kpis
  USING (tenant_id = current_tenant_id());

-- reports.report_schedules
ALTER TABLE reports.report_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports.report_schedules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON reports.report_schedules;
CREATE POLICY tenant_isolation ON reports.report_schedules
  USING (tenant_id = current_tenant_id());

-- _outbox.messages
ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages;
CREATE POLICY tenant_isolation ON _outbox.messages
  USING (tenant_id = current_tenant_id());
