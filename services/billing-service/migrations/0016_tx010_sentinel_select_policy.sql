-- Fix: TX-010 -- sentinel-tenant defaults without a sentinel SELECT policy.
--
-- plans.billing_plans and plans.billing_plan_features both default tenant_id
-- to this codebase's established sentinel/platform-default value
-- ('00000000-0000-0000-0000-000000000000' -- see migration 0001_init.sql
-- lines 13 and 29), but the only RLS policy on either table is the blanket
-- all-commands tenant_isolation_policy (0003_rls_tenant_isolation.sql,
-- superseded by 0006_rls_full_tenant_isolation.sql): USING/WITH CHECK
-- (tenant_id = plans.current_tenant_id()). A real tenant's
-- plans.current_tenant_id() is never the zero UUID, so platform-default
-- plans are invisible to every real tenant unless the reader explicitly
-- switches app.tenant_id to the sentinel value first.
--
-- Real-world impact already visible in modules/plans/repo.ts: list() and
-- findById() both have to SET LOCAL "app.tenant_id" to the sentinel value
-- (SET_SYSTEM_TENANT) around every read of billing_plans just to see the
-- platform plan catalogue at all. billing_plan_features carries the
-- identical schema shape (same sentinel default, same single blanket
-- policy) with no reader wired up yet -- fixed here at the schema level
-- before any caller has to rediscover the same GUC-switching workaround.
--
-- Fix shape (identical, established pattern: asset-service
-- 0023_asset_categories_platform_wide_read.sql, notification-service
-- 0045_templates_rls_platform_wide_read.sql, admin-service's own
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
-- Rollback: DROP POLICY platform_wide_plan_read ON plans.billing_plans;
--           DROP POLICY platform_wide_plan_feature_read ON plans.billing_plan_features;
-- Affected services: billing-service

SET lock_timeout = '5s';

DROP POLICY IF EXISTS platform_wide_plan_read ON plans.billing_plans;
CREATE POLICY platform_wide_plan_read ON plans.billing_plans
  FOR SELECT
  USING (tenant_id = '00000000-0000-0000-0000-000000000000'::uuid);

DROP POLICY IF EXISTS platform_wide_plan_feature_read ON plans.billing_plan_features;
CREATE POLICY platform_wide_plan_feature_read ON plans.billing_plan_features
  FOR SELECT
  USING (tenant_id = '00000000-0000-0000-0000-000000000000'::uuid);
