-- Purpose: GAP-TENANT-ADMIN-ACTIVATION-05. GET /v1/analytics/activation/funnel/platform
--          (platform_admin / super_admin only) must read activation events across ALL
--          offices, but a request's RLS GUC (app.tenant_id) is always the CALLER's own
--          tenant, so under FORCE RLS the platform funnel silently returned only the
--          caller's office. Add an additional permissive SELECT-only policy gated by a
--          GUC (app.platform_bypass) that only trusted server-side code sets, after the
--          route has authorized a platform role. Same design as admin-service 0011:
--          permissive policies OR together, so the strict tenant_isolation_policy still
--          governs every other read; INSERT/UPDATE/DELETE are untouched (no bypass
--          policy for those commands), so a write can never skip tenant scoping.
-- Rollback: DROP POLICY IF EXISTS platform_bypass_read_policy ON analytics.fact_events;
-- Affected services: analytics-service

SET lock_timeout = '5s';

DROP POLICY IF EXISTS platform_bypass_read_policy ON analytics.fact_events;
CREATE POLICY platform_bypass_read_policy ON analytics.fact_events
  FOR SELECT
  USING (current_setting('app.platform_bypass', true) = 'true');
