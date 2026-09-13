-- Migration: 0041_sec010_dmn_tables_rls.sql
-- Purpose: SEC-010 -- workflow.dmn_tables (0027_dmn_tables.sql) was created after
--          workflow-service's RLS isolation sweep (0018_rls_full_tenant_isolation.sql)
--          and never got row-level security at all -- not even ENABLE.
-- RLS: full tenant isolation, mirroring 0031_case_task_mgmt.sql's own precedent for
--      this exact gap shape ("0030 shipped the tables with NO row-level security ...
--      Enable + FORCE fail-closed RLS"): workflow.current_tenant_id(), ENABLE + FORCE +
--      tenant_isolation_policy (USING + WITH CHECK). workflow_svc is NOBYPASSRLS and
--      owns this table (per-service migrations run as the service role by default), so
--      FORCE is required for the policy to actually apply to it, not just ENABLE.
-- App-layer check: src/modules/dmn/{commands,routes,consumer}.ts already read/write
-- dmn_tables exclusively through scopedRead()/db.transaction(), which sets
-- app.tenant_id via wrapWithTenantGuc -- no companion code change needed, no
-- regression expected.
-- Additive + idempotent. Safe to re-run.
-- Rollback: ALTER TABLE workflow.dmn_tables DISABLE ROW LEVEL SECURITY;
--           DROP POLICY tenant_isolation_policy ON workflow.dmn_tables;
-- Affected services: workflow-service

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION workflow.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

ALTER TABLE workflow.dmn_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.dmn_tables FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON workflow.dmn_tables;
DROP POLICY IF EXISTS tenant_isolation ON workflow.dmn_tables;
CREATE POLICY tenant_isolation_policy ON workflow.dmn_tables
  USING (tenant_id = workflow.current_tenant_id())
  WITH CHECK (tenant_id = workflow.current_tenant_id());
