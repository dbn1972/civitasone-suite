-- 0026_asset_scanner_role.sql
-- Cross-tenant maintenance scanner role for asset-service's depreciation
-- scheduler.
--
-- WHY: depreciation.asset_dep_entries is FORCE ROW LEVEL SECURITY
-- (0007_rls_tenant_isolation.sql / 0009_rls_full_tenant_isolation.sql) and
-- the service connects as the least-privilege role asset_svc (NOBYPASSRLS).
-- The depreciation scheduler (src/modules/depreciation/scheduler.ts ->
-- repo.findDueTenantPeriods()) must scan ALL tenants to find (tenant,
-- period) pairs with unposted entries:
--
--   scannerDb.selectDistinct({ tenantId, period }).from(assetDepEntries)
--     .where(and(isNull(assetDepEntries.postedAt), lte(assetDepEntries.period, uptoPeriod)))
--
-- Under asset_svc, a bare cross-tenant SELECT like this returns ZERO rows
-- because no app.tenant_id GUC is set for that scan (tenant_isolation_policy
-- has no match) -- so the scheduler silently never finds anything to post,
-- in any real environment. src/shared/scanner-db.ts already wires a second
-- pool for exactly this (ASSET_SCANNER_DATABASE_URL, falling back to
-- DATABASE_URL only in dev where the connection is RLS-inert) but the role
-- it needs to point at was never provisioned. This migration is that role.
--
-- Mirrors visitor-service's shared/scanner-db.ts pattern (migration
-- 0009_scanner_role.sql) -- asset-service's own scanner-db.ts doc-comment
-- already cites visitor-service as the pattern it mirrors -- using the same
-- password-GUC convention as payroll-service 0032/works-service 0012/
-- court-service 0016.
--
-- SECURITY: scoped to exactly the one table findDueTenantPeriods() reads --
-- depreciation.asset_dep_entries -- not the whole depreciation schema, and
-- nowhere else in asset-service (register/lifecycle/maintenance/insurance/
-- enterprise/_outbox/_inbox are untouched; depreciation.asset_dep_schedules
-- is untouched too since no scanner query reads it today). Grep of
-- `scannerDb` across services/asset-service/src confirms this is the ONLY
-- call site. It is READ-ONLY (SELECT only) -- no INSERT/UPDATE/DELETE
-- anywhere. All WRITES (posting entries) still go through asset_svc inside
-- runWithTenant(row.tenantId, ...) via the depRun consumer, so RLS
-- re-checks every mutation. Widening this role's grants beyond this one
-- table later should get its own narrowly-scoped follow-up migration rather
-- than a silent broadening here (same reasoning as payroll-service's
-- 0040_payroll_audit_scanner_role.sql: don't erode a documented boundary to
-- make an unrelated future need "just work").
--
-- SECURITY (SEC-P1-09): no password literal ships in this migration. Set
-- `civitas.asset_scanner_password` from your secrets manager BEFORE running
-- migrations in prod, e.g.
--   PGOPTIONS="-c civitas.asset_scanner_password=$(vault kv get -field=pw ...)" \
--     <run migrations>
-- When the GUC is absent (local/dev), a RANDOM one-time password is
-- generated so no known credential exists for this BYPASSRLS role in that
-- environment (dev connects as the RLS-inert superuser per scanner-db.ts's
-- own DATABASE_URL fallback, so the scanner login password is not used
-- there anyway).

DO $$
DECLARE
  scanner_pw text := coalesce(
    nullif(current_setting('civitas.asset_scanner_password', true), ''),
    -- No pgcrypto dependency: 64 hex chars of non-deterministic entropy.
    md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text)
  );
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'asset_scanner') THEN
    EXECUTE format(
      'CREATE ROLE asset_scanner LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS',
      scanner_pw);
  ELSE
    -- Only rotate the password when one was explicitly provided via the GUC;
    -- otherwise leave the existing password untouched (idempotent re-runs).
    IF nullif(current_setting('civitas.asset_scanner_password', true), '') IS NOT NULL THEN
      EXECUTE format('ALTER ROLE asset_scanner PASSWORD %L', scanner_pw);
    END IF;
    ALTER ROLE asset_scanner BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

-- Read-only: SELECT on exactly the table findDueTenantPeriods() scans. No
-- USAGE/SELECT granted on any other schema or table.
GRANT USAGE ON SCHEMA depreciation TO asset_scanner;
GRANT SELECT ON depreciation.asset_dep_entries TO asset_scanner;

-- L1 isolation (DB-per-service) may revoke PUBLIC CONNECT on this database;
-- the scanner must be able to connect to THIS service database.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO asset_scanner', current_database());
END
$$;
