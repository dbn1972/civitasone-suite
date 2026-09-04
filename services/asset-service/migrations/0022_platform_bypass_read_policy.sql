-- Purpose: add SELECT-only, additional permissive RLS policies (gated by the
--   `app.platform_bypass` GUC) on every asset-service table
--   services/inventory-service/tests/data-quality.test.ts reads for its
--   cross-service evidence checks (DQ-ASSET-*). Mirrors admin-service's
--   migration 0011 / audit-service's migration 0021 (scopedPlatformRead
--   pattern) exactly: `app.platform_bypass` is ONLY ever set by trusted,
--   hardcoded, no-user-input test/CI code (data-quality.test.ts's connect()
--   helper) — never derived from client input. Postgres combines multiple
--   permissive policies for the same command with OR, so this coexists with
--   (never replaces) the existing strict tenant_isolation policy: SELECT is
--   allowed if EITHER the strict per-tenant match holds OR the bypass GUC is
--   set for this connection. INSERT/UPDATE/DELETE are UNCHANGED and still
--   governed solely by the strict tenant-match policy (no bypass policy
--   added for those commands) — this suite never writes, but the safety
--   margin is structural, not merely behavioral.
--
--   Root cause this fixes: civitas_admin is deliberately NOSUPERUSER
--   NOBYPASSRLS (bootstrap_admin_role.sql) and every one of these tables has
--   FORCE ROW LEVEL SECURITY keyed on current_tenant_id(). connect() never
--   set app.tenant_id, so every DQ-ASSET-* check silently saw zero rows
--   regardless of actual content — confirmed via a live sabotage test (a bad
--   depreciation-schedule row inserted as superuser stayed invisible to
--   civitas_admin's DQ-ASSET-05 query).
--
-- Rollback:
--   DROP POLICY platform_bypass_read_policy ON register.asset_assets;
--   DROP POLICY platform_bypass_read_policy ON depreciation.asset_dep_schedules;
--   DROP POLICY platform_bypass_read_policy ON depreciation.asset_dep_entries;
--   DROP POLICY platform_bypass_read_policy ON lifecycle.pending_disposals;
--   DROP POLICY platform_bypass_read_policy ON lifecycle.asset_acquisitions;
-- Affected services: asset-service

SET lock_timeout = '5s';

DROP POLICY IF EXISTS platform_bypass_read_policy ON register.asset_assets;
CREATE POLICY platform_bypass_read_policy ON register.asset_assets
  FOR SELECT
  USING (current_setting('app.platform_bypass', true) = 'true');

DROP POLICY IF EXISTS platform_bypass_read_policy ON depreciation.asset_dep_schedules;
CREATE POLICY platform_bypass_read_policy ON depreciation.asset_dep_schedules
  FOR SELECT
  USING (current_setting('app.platform_bypass', true) = 'true');

DROP POLICY IF EXISTS platform_bypass_read_policy ON depreciation.asset_dep_entries;
CREATE POLICY platform_bypass_read_policy ON depreciation.asset_dep_entries
  FOR SELECT
  USING (current_setting('app.platform_bypass', true) = 'true');

DROP POLICY IF EXISTS platform_bypass_read_policy ON lifecycle.pending_disposals;
CREATE POLICY platform_bypass_read_policy ON lifecycle.pending_disposals
  FOR SELECT
  USING (current_setting('app.platform_bypass', true) = 'true');

DROP POLICY IF EXISTS platform_bypass_read_policy ON lifecycle.asset_acquisitions;
CREATE POLICY platform_bypass_read_policy ON lifecycle.asset_acquisitions
  FOR SELECT
  USING (current_setting('app.platform_bypass', true) = 'true');
