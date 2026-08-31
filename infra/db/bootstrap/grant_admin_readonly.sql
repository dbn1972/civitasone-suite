-- grant_admin_readonly.sql
--
-- Purpose: grant civitas_admin READ-ONLY (USAGE + SELECT, no BYPASSRLS) access
-- to every non-system schema in the database it is run against, WITHOUT
-- transferring ownership or elevating civitas_admin's role attributes.
--
-- WHY: services/inventory-service/tests/data-quality.test.ts (and the sibling
-- finance/payroll/procurement/contract/hrms/asset reconciliation checks in the
-- same file) connect as civitas_admin to run read-only cross-service evidence
-- queries. civitas_admin is deliberately NOSUPERUSER NOBYPASSRLS
-- (bootstrap_admin_role.sql) and owns only the admin-owned services
-- (inspection/metadata/court/ml/revenue/works) — it was never granted into
-- service-owned databases like civitas_inventory or civitas_asset, so those
-- checks failed with `permission denied for schema inventory` etc.
--
-- This closes that gap WITHOUT BYPASSRLS: civitas_admin still cannot see other
-- tenants' rows through RLS — it can only now see the schema/tables that the
-- service role's own migrations created, the same as connecting directly as
-- that service role would allow.
--
-- Run AFTER a service's migrations, as the schema-owning service role, against
-- that service's own database:
--
--   psql -U inventory_svc -d civitas_inventory -f grant_admin_readonly.sql
--
-- Idempotent; safe to re-run after new migrations add schemas/tables.

DO $$
DECLARE
  s text;
BEGIN
  FOR s IN
    SELECT nspname FROM pg_namespace
    WHERE nspname NOT LIKE 'pg\_%' AND nspname NOT IN ('information_schema', 'public')
  LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO civitas_admin', s);
    EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO civitas_admin', s);
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT ON TABLES TO civitas_admin',
      current_user, s);
  END LOOP;
END
$$;
