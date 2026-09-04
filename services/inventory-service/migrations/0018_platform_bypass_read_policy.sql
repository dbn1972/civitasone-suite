-- Purpose: add SELECT-only, additional permissive RLS policies (gated by the
--   `app.platform_bypass` GUC) on every table
--   services/inventory-service/tests/data-quality.test.ts reads, so the
--   suite's civitas_admin connection can genuinely see cross-tenant rows for
--   read-only evidence checks. Mirrors admin-service's migration 0011 /
--   audit-service's migration 0021 (scopedPlatformRead pattern) exactly:
--   `app.platform_bypass` is ONLY ever set by trusted, hardcoded, no-user-input
--   test/CI code (data-quality.test.ts's connect() helper) — never derived
--   from client input. Postgres combines multiple permissive policies for the
--   same command with OR, so this coexists with (never replaces) the existing
--   strict tenant_isolation policy: SELECT is allowed if EITHER the strict
--   per-tenant match holds OR the bypass GUC is set for this connection.
--   INSERT/UPDATE/DELETE are UNCHANGED and still governed solely by the
--   strict tenant-match policy (no bypass policy added for those commands) —
--   this suite never writes, but the safety margin is structural, not merely
--   behavioral.
--
--   Root cause this fixes: civitas_admin is deliberately NOSUPERUSER
--   NOBYPASSRLS (bootstrap_admin_role.sql) and every one of these tables has
--   FORCE ROW LEVEL SECURITY keyed on current_tenant_id() (reads
--   current_setting('app.tenant_id', true)). connect() never set that GUC,
--   so the strict policy's `tenant_id = current_tenant_id()` never matched
--   (current_tenant_id() is NULL under no GUC) and every DQ-INV-* check
--   silently saw zero rows regardless of what was actually in the table —
--   confirmed via a live sabotage test (bad rows inserted as superuser,
--   still invisible to civitas_admin's queries).
--
-- Rollback:
--   DROP POLICY platform_bypass_read_policy ON inventory.stock_balances;
--   DROP POLICY platform_bypass_read_policy ON inventory.stock_ledger;
--   DROP POLICY platform_bypass_read_policy ON inventory.items;
--   DROP POLICY platform_bypass_read_policy ON inventory.batches;
--   DROP POLICY platform_bypass_read_policy ON inventory.movement_lines;
--   DROP POLICY platform_bypass_read_policy ON inventory.movements;
--   DROP POLICY platform_bypass_read_policy ON inventory.serial_numbers;
-- Affected services: inventory-service

SET lock_timeout = '5s';

DROP POLICY IF EXISTS platform_bypass_read_policy ON inventory.stock_balances;
CREATE POLICY platform_bypass_read_policy ON inventory.stock_balances
  FOR SELECT
  USING (current_setting('app.platform_bypass', true) = 'true');

DROP POLICY IF EXISTS platform_bypass_read_policy ON inventory.stock_ledger;
CREATE POLICY platform_bypass_read_policy ON inventory.stock_ledger
  FOR SELECT
  USING (current_setting('app.platform_bypass', true) = 'true');

DROP POLICY IF EXISTS platform_bypass_read_policy ON inventory.items;
CREATE POLICY platform_bypass_read_policy ON inventory.items
  FOR SELECT
  USING (current_setting('app.platform_bypass', true) = 'true');

DROP POLICY IF EXISTS platform_bypass_read_policy ON inventory.batches;
CREATE POLICY platform_bypass_read_policy ON inventory.batches
  FOR SELECT
  USING (current_setting('app.platform_bypass', true) = 'true');

DROP POLICY IF EXISTS platform_bypass_read_policy ON inventory.movement_lines;
CREATE POLICY platform_bypass_read_policy ON inventory.movement_lines
  FOR SELECT
  USING (current_setting('app.platform_bypass', true) = 'true');

DROP POLICY IF EXISTS platform_bypass_read_policy ON inventory.movements;
CREATE POLICY platform_bypass_read_policy ON inventory.movements
  FOR SELECT
  USING (current_setting('app.platform_bypass', true) = 'true');

DROP POLICY IF EXISTS platform_bypass_read_policy ON inventory.serial_numbers;
CREATE POLICY platform_bypass_read_policy ON inventory.serial_numbers
  FOR SELECT
  USING (current_setting('app.platform_bypass', true) = 'true');
