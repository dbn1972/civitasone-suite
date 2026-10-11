-- 0002_smarttransfer_scanner_role.sql
-- Cross-tenant maintenance scanner role for the smarttransfer worker.
--
-- WHY: _outbox.messages and _inbox.command_results are FORCE ROW LEVEL SECURITY
-- (0001; D-20) and the service connects as the least-privilege NOBYPASSRLS role
-- smarttransfer_svc. The outbox relay and the retention purge must scan ACROSS
-- ALL TENANTS with no app.tenant_id GUC, which would see ZERO rows under
-- smarttransfer_svc. This dedicated BYPASSRLS role is used by those two worker
-- loops ONLY; it never touches smarttransfer.* business tables.
--
-- Mirrors court-service 0016_court_scanner_role.sql. D-20: the command-result
-- purge is scanner-role only, so the grants below are the minimum each loop
-- issues (relay: SELECT + UPDATE published_at; purge: DELETE).
--
-- SECURITY: no password literal ships here. Set `civitas.smarttransfer_scanner_password`
-- from the secrets manager BEFORE running migrations in prod. When absent
-- (local/dev), a RANDOM one-time password is generated.

DO $$
DECLARE
  scanner_pw text := coalesce(
    nullif(current_setting('civitas.smarttransfer_scanner_password', true), ''),
    md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text)
  );
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smarttransfer_scanner') THEN
    EXECUTE format(
      'CREATE ROLE smarttransfer_scanner LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS',
      scanner_pw);
  ELSE
    IF nullif(current_setting('civitas.smarttransfer_scanner_password', true), '') IS NOT NULL THEN
      EXECUTE format('ALTER ROLE smarttransfer_scanner PASSWORD %L', scanner_pw);
    END IF;
    ALTER ROLE smarttransfer_scanner BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA _outbox, _inbox TO smarttransfer_scanner;
GRANT SELECT, UPDATE, DELETE ON _outbox.messages TO smarttransfer_scanner;
GRANT SELECT, DELETE ON _inbox.processed TO smarttransfer_scanner;
GRANT SELECT, DELETE ON _inbox.command_results TO smarttransfer_scanner;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO smarttransfer_scanner', current_database());
END
$$;
