-- bootstrap_inspection.sql
--
-- Purpose: provision the inspection-service database and login role.
--
-- WHY THIS FILE EXISTS
-- Every other deployed service had its role and database provisioned, but
-- inspection-service had neither: `inspection_svc` did not exist as a role and
-- `civitas_inspection` did not exist as a database. The service was declared in
-- ecosystem.config.js and routed in the gateway registry, and it carries 39 test
-- files at 78.6% line coverage — but it could never have started, because it had
-- nowhere to connect. Discovered 2026-07-27 while bringing up the last
-- non-serving services.
--
-- Mirrors the convention verified against civitas_court / court_svc:
--   role : NOSUPERUSER, NOCREATEDB, LOGIN, NOBYPASSRLS  (RLS must apply)
--   db   : owned by civitas_admin, UTF8
--   privs: service role gets CONNECT on the db and USAGE on its schemas;
--          schema ownership stays with civitas_admin so migrations are
--          admin-run and the service role cannot alter its own tables.
--
-- Rollback:
--   DROP DATABASE IF EXISTS civitas_inspection;
--   DROP ROLE IF EXISTS inspection_svc;
--
-- Idempotent: safe to re-run. Run as civitas_admin against the `postgres` db.
-- Migrations are applied separately (services/inspection-service/migrations).

-- ── Login role ───────────────────────────────────────────────────────────────
-- NOBYPASSRLS is deliberate and load-bearing: the L3 lane asserts that no *_svc
-- role can bypass row-level security, which is what keeps tenant isolation
-- enforceable at the database rather than only in application code.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'inspection_svc') THEN
    CREATE ROLE inspection_svc
      LOGIN
      PASSWORD 'inspection_dev_pw'
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOBYPASSRLS
      INHERIT;
  ELSE
    -- Re-assert the security-relevant attributes in case they drifted.
    ALTER ROLE inspection_svc NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS LOGIN;
  END IF;
END
$$;

-- ── Database ─────────────────────────────────────────────────────────────────
-- CREATE DATABASE cannot run inside a transaction block or a DO body, so it is
-- guarded by \gexec: the SELECT emits the statement only when the db is absent.
SELECT 'CREATE DATABASE civitas_inspection OWNER civitas_admin ENCODING ''UTF8'''
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'civitas_inspection')
\gexec

-- ── Connect privilege ────────────────────────────────────────────────────────
REVOKE ALL ON DATABASE civitas_inspection FROM PUBLIC;
GRANT CONNECT ON DATABASE civitas_inspection TO inspection_svc;

-- ── Schema + object privileges (run AFTER migrations create the schemas) ─────
-- Mirrors civitas_court: the service role gets USAGE on each schema and DML on
-- its objects, but NOT ownership — schemas stay owned by civitas_admin so
-- migrations are admin-run and the service cannot ALTER its own tables.
--
-- Re-run this section after any migration that adds a schema.
DO $$
DECLARE
  s text;
BEGIN
  FOR s IN
    SELECT nspname FROM pg_namespace
    WHERE nspname NOT LIKE 'pg_%' AND nspname NOT IN ('information_schema', 'public')
  LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO inspection_svc', s);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO inspection_svc', s);
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO inspection_svc', s);
    -- Future objects created by civitas_admin in this schema.
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO inspection_svc', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO inspection_svc', s);
  END LOOP;
END
$$;
