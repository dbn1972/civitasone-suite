-- Fixes inventory.warehouses' tenant_isolation RLS policy (introduced in
-- 0010_canonical_warehouses.sql), which inlined the single-argument form
-- current_setting('app.tenant_id')::uuid instead of the shared
-- current_tenant_id() helper (defined in 0003_rls_tenant_isolation.sql /
-- 0004_rls_full_tenant_isolation.sql) every other table in this service uses.
--
-- Bug: current_setting('app.tenant_id') with no missing_ok argument raises
-- `unrecognized configuration parameter "app.tenant_id"` whenever a
-- connection queries this FORCE RLS table without app.tenant_id having been
-- set in that Postgres session (e.g. a request with no x-tenant-id header,
-- so createTenantTxHook's AsyncLocalStorage tenant context is empty and
-- db.transaction() runs with no GUC set — see packages/db/src/tenant-db.ts).
-- That raises a raw PostgresError which surfaces as an HTTP 500, instead of
-- current_tenant_id()'s NULLIF(current_setting('app.tenant_id', true), '')
-- pattern, which returns NULL and lets RLS gracefully filter to zero rows —
-- the behavior every sibling table in this service (items, stores, etc.)
-- already has.
--
-- Rollback: re-run 0010's DO block (recreates the policy with the old,
-- buggy USING/WITH CHECK clauses).

SET lock_timeout = '5s';

DROP POLICY IF EXISTS tenant_isolation ON inventory.warehouses;

CREATE POLICY tenant_isolation ON inventory.warehouses
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
