-- 0022_inspection_scanner_role.sql
-- Cross-tenant maintenance scanner role for inspection-service scheduled workers.
--
-- WHY: inspection domain tables and _outbox.messages are FORCE ROW LEVEL
-- SECURITY and the service connects as inspection_svc (NOBYPASSRLS). Once
-- 0023_outbox_inbox_rls.sql applies FORCE RLS to _outbox.messages, the outbox
-- relay + scheduled purge (worker.ts) — which must scan unpublished/old rows
-- ACROSS ALL TENANTS — would otherwise see ZERO rows under inspection_svc.
-- This dedicated BYPASSRLS role lets those maintenance loops see every
-- tenant's outbox rows.
--
-- Mirrors works-service 0012_works_scanner_role.sql / contract-service
-- 0015_contract_scanner_role.sql (same password-GUC convention).
--
-- SECURITY (SEC-P1-09): no password literal ships in this migration. Set
-- `civitas.inspection_scanner_password` from your secrets manager BEFORE
-- running migrations in prod.

DO $$
DECLARE
  scanner_pw text := coalesce(
    nullif(current_setting('civitas.inspection_scanner_password', true), ''),
    md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text)
  );
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'inspection_scanner') THEN
    EXECUTE format(
      'CREATE ROLE inspection_scanner LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS',
      scanner_pw);
  ELSE
    IF nullif(current_setting('civitas.inspection_scanner_password', true), '') IS NOT NULL THEN
      EXECUTE format('ALTER ROLE inspection_scanner PASSWORD %L', scanner_pw);
    END IF;
    ALTER ROLE inspection_scanner BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA _outbox, _inbox TO inspection_scanner;
GRANT SELECT, INSERT, UPDATE, DELETE ON _outbox.messages TO inspection_scanner;
GRANT SELECT, DELETE ON _inbox.processed TO inspection_scanner;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO inspection_scanner', current_database());
END
$$;
