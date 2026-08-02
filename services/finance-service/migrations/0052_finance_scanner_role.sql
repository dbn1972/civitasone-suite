-- 0052_finance_scanner_role.sql
-- Cross-tenant maintenance scanner role for finance-service scheduled workers.
--
-- Mirrors payroll-service 0032_payroll_scanner_role.sql.
-- SECURITY (SEC-P1-09): no password literal ships in this migration. Set
-- `civitas.finance_scanner_password` from your secrets manager BEFORE running
-- migrations in prod.

DO $$
DECLARE
  scanner_pw text := coalesce(
    nullif(current_setting('civitas.finance_scanner_password', true), ''),
    md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text)
  );
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finance_scanner') THEN
    EXECUTE format(
      'CREATE ROLE finance_scanner LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS',
      scanner_pw);
  ELSE
    IF nullif(current_setting('civitas.finance_scanner_password', true), '') IS NOT NULL THEN
      EXECUTE format('ALTER ROLE finance_scanner PASSWORD %L', scanner_pw);
    END IF;
    ALTER ROLE finance_scanner BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA _outbox, _inbox TO finance_scanner;
GRANT SELECT, INSERT, UPDATE, DELETE ON _outbox.messages TO finance_scanner;
GRANT SELECT, DELETE ON _inbox.processed TO finance_scanner;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO finance_scanner', current_database());
END
$$;
