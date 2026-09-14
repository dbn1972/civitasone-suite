-- Fix: TX-010 -- sentinel-tenant defaults without a sentinel SELECT policy.
--
-- config.admin_feature_flags and health.admin_health_snapshots both default
-- tenant_id to this codebase's established sentinel/platform-default value
-- ('00000000-0000-0000-0000-000000000000' -- see migration 0001_init.sql
-- lines 60 and 76), but the only RLS policy on either table is the blanket
-- all-commands tenant_isolation_policy (0005_rls_tenant_isolation.sql,
-- superseded by 0006_rls_full_tenant_isolation.sql): USING/WITH CHECK
-- (tenant_id = current_tenant_id()). A real tenant's current_tenant_id() is
-- never the zero UUID, so platform-default rows are invisible to every real
-- tenant unless the reader explicitly switches app.tenant_id to the
-- sentinel/PLATFORM value first.
--
-- Real-world impact already visible in modules/config/repo.ts: getTenantConfig,
-- listFlags and setFlagOverride all have to manually
-- runWithTenant(PLATFORM, ...) / set_config('app.tenant_id', PLATFORM, ...)
-- around every read of admin_feature_flags just to see the sentinel rows at
-- all (setFlagOverride's comment documents one such read that was originally
-- missed entirely and returned "flag not found" for every override).
-- health.admin_health_snapshots carries the identical schema shape (same
-- sentinel default, same single blanket policy) with no reader wired up yet
-- -- fixed here at the schema level before any caller has to rediscover the
-- same GUC-switching workaround.
--
-- Fix shape (identical, established pattern: asset-service
-- 0023_asset_categories_platform_wide_read.sql, notification-service
-- 0045_templates_rls_platform_wide_read.sql, this service's own
-- 0033_org_hierarchy_levels.sql): do NOT touch the existing all-commands
-- tenant_isolation_policy -- it correctly keeps INSERT/UPDATE/DELETE (and
-- ordinary SELECT) scoped to a tenant's own rows. Instead ADD a second,
-- purely additive PERMISSIVE policy for SELECT only on each table, granting
-- visibility into the sentinel-tenant rows to every session regardless of
-- its own app.tenant_id. Postgres ORs together permissive policies for the
-- same command, so SELECT now succeeds if EITHER predicate holds (own
-- tenant OR platform-wide); INSERT/UPDATE/DELETE remain governed solely by
-- the strict policy above, so an ordinary tenant still can never
-- write/tamper with the sentinel rows.
--
-- DoD (per docs/ENTERPRISE-GAP-REPORT-2026-09-07.md, TX-010): reading
-- without a GUC switch returns the platform rows.
--
-- Idempotent: safe to re-run.
-- Rollback: DROP POLICY platform_wide_feature_flag_read ON config.admin_feature_flags;
--           DROP POLICY platform_wide_health_snapshot_read ON health.admin_health_snapshots;
-- Affected services: admin-service

SET lock_timeout = '5s';

DROP POLICY IF EXISTS platform_wide_feature_flag_read ON config.admin_feature_flags;
CREATE POLICY platform_wide_feature_flag_read ON config.admin_feature_flags
  FOR SELECT
  USING (tenant_id = '00000000-0000-0000-0000-000000000000'::uuid);

DROP POLICY IF EXISTS platform_wide_health_snapshot_read ON health.admin_health_snapshots;
CREATE POLICY platform_wide_health_snapshot_read ON health.admin_health_snapshots
  FOR SELECT
  USING (tenant_id = '00000000-0000-0000-0000-000000000000'::uuid);
