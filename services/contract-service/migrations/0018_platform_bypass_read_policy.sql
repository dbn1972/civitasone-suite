-- Purpose: add SELECT-only, additional permissive RLS policies (gated by the
--   `app.platform_bypass` GUC) on contracts.contract_contracts and
--   contracts.contract_milestones, the tables
--   services/inventory-service/tests/data-quality.test.ts reads for its
--   cross-service evidence checks (DQ-CONTRACT-*). Mirrors admin-service's
--   migration 0011 / audit-service's migration 0021 (scopedPlatformRead
--   pattern) exactly: `app.platform_bypass` is ONLY ever set by trusted,
--   hardcoded, no-user-input test/CI code (data-quality.test.ts's connect()
--   helper) — never derived from client input. Postgres combines multiple
--   permissive policies for the same command with OR, so this coexists with
--   (never replaces) the existing strict tenant_isolation policy: SELECT is
--   allowed if EITHER the strict per-tenant match holds OR the bypass GUC is
--   set for this connection. INSERT/UPDATE/DELETE are UNCHANGED and still
--   governed solely by the strict tenant-match policy — this suite never
--   writes, but the safety margin is structural, not merely behavioral.
--
--   Root cause this fixes: civitas_admin is deliberately NOSUPERUSER
--   NOBYPASSRLS (bootstrap_admin_role.sql) and both tables have FORCE ROW
--   LEVEL SECURITY keyed on current_tenant_id(). connect() never set
--   app.tenant_id, so DQ-CONTRACT-03 (orphan milestones) silently saw zero
--   rows regardless of actual content — confirmed via a live sabotage test
--   (an orphan milestone inserted as superuser stayed invisible to
--   civitas_admin's query).
--
-- Rollback:
--   DROP POLICY platform_bypass_read_policy ON contracts.contract_contracts;
--   DROP POLICY platform_bypass_read_policy ON contracts.contract_milestones;
-- Affected services: contract-service

SET lock_timeout = '5s';

DROP POLICY IF EXISTS platform_bypass_read_policy ON contracts.contract_contracts;
CREATE POLICY platform_bypass_read_policy ON contracts.contract_contracts
  FOR SELECT
  USING (current_setting('app.platform_bypass', true) = 'true');

DROP POLICY IF EXISTS platform_bypass_read_policy ON contracts.contract_milestones;
CREATE POLICY platform_bypass_read_policy ON contracts.contract_milestones
  FOR SELECT
  USING (current_setting('app.platform_bypass', true) = 'true');
