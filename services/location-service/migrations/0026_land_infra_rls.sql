-- Migration: 0026_land_infra_rls.sql
-- Purpose (GAP2-LOCATIONS-INFRA-RLS-01 / GAP2-PLATFORM-LOCATION-RLS-01, SEC-009/010):
--   Retrofit ENABLE + FORCE ROW LEVEL SECURITY + tenant_isolation_policy onto the
--   three land/infrastructure tenant tables (land_records holds citizen PII:
--   owner_name). These tables were created in 0013 WITHOUT inline RLS; the retrofit
--   lives in 0014, but 0014 opens with `CREATE EXTENSION postgis` and is skipped on
--   any cluster without PostGIS (and the whole chain can strand before it under the
--   old migrate-all abort-on-error behaviour), leaving these three tables with
--   relrowsecurity=f / relforcerowsecurity=f / 0 policies in a migrate-provisioned DB.
--   This migration carries the retrofit with NO PostGIS dependency and NO
--   `CREATE INDEX CONCURRENTLY`, so it applies cleanly regardless of PostGIS and
--   can run inside the normal migration pipeline. Plain, per-table ENABLE/FORCE/
--   CREATE POLICY statements (not a DO-loop) so tenant-table-rls-guard recognises
--   each table's same-file RLS.
-- Additive, idempotent. Safe to re-run.
-- Rollback:
--   DROP POLICY IF EXISTS tenant_isolation_policy ON location.land_records;
--   ALTER TABLE location.land_records DISABLE ROW LEVEL SECURITY;
--   DROP POLICY IF EXISTS tenant_isolation_policy ON location.infrastructure_assets;
--   ALTER TABLE location.infrastructure_assets DISABLE ROW LEVEL SECURITY;
--   DROP POLICY IF EXISTS tenant_isolation_policy ON location.infrastructure_inspections;
--   ALTER TABLE location.infrastructure_inspections DISABLE ROW LEVEL SECURITY;

SET lock_timeout = '5s';

-- current_tenant_id(): resolves the tenant from the app.tenant_id GUC. Defined
-- idempotently here too (0006 defines the same function) so this migration does
-- not depend on 0006/0014 having created it first.
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- location.land_records (citizen PII: owner_name)
ALTER TABLE location.land_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE location.land_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON location.land_records;
CREATE POLICY tenant_isolation_policy ON location.land_records
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- location.infrastructure_assets
ALTER TABLE location.infrastructure_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE location.infrastructure_assets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON location.infrastructure_assets;
CREATE POLICY tenant_isolation_policy ON location.infrastructure_assets
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- location.infrastructure_inspections
ALTER TABLE location.infrastructure_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE location.infrastructure_inspections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON location.infrastructure_inspections;
CREATE POLICY tenant_isolation_policy ON location.infrastructure_inspections
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
