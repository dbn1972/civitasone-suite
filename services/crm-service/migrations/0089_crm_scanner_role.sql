-- 0089_crm_scanner_role.sql
-- Cross-tenant maintenance scanner role for crm-service scheduled workers.
--
-- Bug: crm.list_document_alert_tenants() (0068, DM-002) is SECURITY DEFINER
-- and relies on its owner bypassing RLS to discover which tenants have rows
-- on crm.document_types / crm.documents (both FORCE ROW LEVEL SECURITY). Its
-- owner is civitas_admin, the migration-running role — but
-- bootstrap_admin_role.sql deliberately creates civitas_admin as NOSUPERUSER
-- NOBYPASSRLS ("so RLS still binds it ... the L3 lane asserts no `%_svc`
-- role holds BYPASSRLS, and civitas_admin must not become a hole in that").
-- Under a correctly-bootstrapped database (exactly what scripts/ci/
-- bootstrap-postgres.sh produces) FORCE RLS therefore still applies to this
-- function's effective user, and it returns ZERO cross-tenant rows —
-- runDocumentAlertCycle() silently never fires for any tenant. (On this
-- particular long-lived dev box civitas_admin currently holds live
-- SUPERUSER + BYPASSRLS, which masks the bug here — but that is itself a
-- drift from bootstrap_admin_role.sql's documented invariant, not something
-- to build on.)
--
-- Fix: mirror the pattern already adopted by 14+ other services (see
-- finance-service 0052_finance_scanner_role.sql, payroll-service
-- 0032_payroll_scanner_role.sql, visitor-service 0009_scanner_role.sql, and
-- services/admin-service/migrations/0018_nobypassrls_service_roles.sql,
-- which states the model directly: "Scanner roles ... intentionally keep
-- BYPASSRLS for cross-tenant sweeper work"). A dedicated, narrowly-scoped
-- LOGIN role with BYPASSRLS, used ONLY for tenant discovery — never for
-- tenant-scoped business reads/writes (those stay on crm_svc, normal RLS,
-- unchanged).
--
-- Scope: read-only, and narrower than finance_scanner (which also relays /
-- purges _outbox/_inbox) — crm_scanner only needs SELECT on document_types /
-- documents and EXECUTE on list_document_alert_tenants().
--
-- Not in scope: crm.list_escalation_tenants() (0047, assignment/scheduler.ts)
-- and crm.list_task_escalation_tenants() (0055, activities/
-- task-escalation-scheduler.ts) have the identical latent defect and the
-- identical fix shape, but are NOT changed here, to keep this fix reviewable.
-- Tracked as a follow-up.
--
-- SECURITY (SEC-P1-09, mirroring 0052/0032/etc.): no password literal ships
-- in this migration. Set `civitas.crm_scanner_password` from your secrets
-- manager BEFORE running migrations in prod.
-- Rollback: REVOKE everything granted below, then DROP ROLE IF EXISTS crm_scanner;
--           (safe — crm_scanner owns nothing).

DO $$
DECLARE
  scanner_pw text := coalesce(
    nullif(current_setting('civitas.crm_scanner_password', true), ''),
    md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text)
  );
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_scanner') THEN
    EXECUTE format(
      'CREATE ROLE crm_scanner LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS',
      scanner_pw);
  ELSE
    IF nullif(current_setting('civitas.crm_scanner_password', true), '') IS NOT NULL THEN
      EXECUTE format('ALTER ROLE crm_scanner PASSWORD %L', scanner_pw);
    END IF;
    ALTER ROLE crm_scanner BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO crm_scanner', current_database());
END
$$;

GRANT USAGE ON SCHEMA crm TO crm_scanner;
GRANT SELECT ON crm.document_types, crm.documents TO crm_scanner;
GRANT EXECUTE ON FUNCTION crm.list_document_alert_tenants() TO crm_scanner;
