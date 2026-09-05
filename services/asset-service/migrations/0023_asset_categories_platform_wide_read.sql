-- Fix: same RLS gap as notification-service's templates.templates
-- (fix/notification-rls-sentinel-template-read).
--
-- register.asset_categories is seeded with two platform-wide default
-- categories (0006b_seed_default_categories.sql: "IT Equipment", "Vehicle"),
-- tenant_id = '00000000-0000-0000-0000-000000000000', explicitly described
-- as "default categories that internal consumers hard-code" — i.e. every
-- real tenant is expected to be able to read them.
--
-- The currently active policy on this table (`tenant_isolation_policy`,
-- created in 0009_rls_full_tenant_isolation.sql, superseding 0007's
-- `tenant_isolation`) is a single blanket policy for ALL commands:
-- USING/WITH CHECK (tenant_id = register.current_tenant_id()). A real
-- tenant's current_tenant_id() is never the zero UUID, so both default
-- categories are invisible to every real tenant even though
-- register.asset_categories is FORCE RLS'd for its owning role too.
--
-- 0022_platform_bypass_read_policy.sql added a DIFFERENT, unrelated read
-- policy to five other asset-service tables (gated by the `app.platform_bypass`
-- GUC, used only by the inventory-service data-quality test suite) — it does
-- not cover register.asset_categories and solves a different problem
-- (trusted-test-harness bypass, not real-tenant read of shared defaults).
--
-- Fix shape (identical to notification-service's fix): do NOT touch the
-- existing all-commands tenant_isolation_policy — it correctly keeps
-- INSERT/UPDATE/DELETE scoped to a tenant's own categories, and ordinary
-- tenants must never be able to write the platform-wide defaults. Instead
-- ADD a second, purely additive PERMISSIVE policy for SELECT only, granting
-- visibility into the sentinel-tenant (zero UUID) rows to every session
-- regardless of its own app.tenant_id. Postgres ORs together permissive
-- policies for the same command, so for SELECT a row is now visible if
-- EITHER policy's predicate holds (own tenant OR platform-wide); writes are
-- untouched.
--
-- Idempotent: safe to re-run.

SET lock_timeout = '5s';

DROP POLICY IF EXISTS platform_wide_category_read ON register.asset_categories;

CREATE POLICY platform_wide_category_read ON register.asset_categories
  FOR SELECT
  USING (tenant_id = '00000000-0000-0000-0000-000000000000'::uuid);
