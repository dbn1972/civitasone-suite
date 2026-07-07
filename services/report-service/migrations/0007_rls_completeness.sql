-- RLS completeness: upgrade USING-only policies to USING + WITH CHECK
-- Purpose: Add WITH CHECK clause for INSERT enforcement on reports.report_schedules
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy ON reports.report_schedules; recreate with USING-only.

SET lock_timeout = '5s';

-- reports.report_schedules
ALTER TABLE reports.report_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports.report_schedules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON reports.report_schedules;
DROP POLICY IF EXISTS tenant_isolation ON reports.report_schedules;
CREATE POLICY tenant_isolation_policy ON reports.report_schedules
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
