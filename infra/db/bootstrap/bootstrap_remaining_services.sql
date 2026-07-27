-- bootstrap_remaining_services.sql
--
-- Purpose: provision the login roles and databases for revenue-, works- and
-- ml-service, none of which existed.
--
-- WHY THIS FILE EXISTS
-- These three were declared in ecosystem.config.js and (revenue, works) routed in
-- the gateway registry, yet had neither a role nor a database — so they could
-- never have started. Same class as inspection-service, found 2026-07-27 when the
-- schema-drift guard refused to write a baseline because their databases were
-- unreachable.
--
-- revenue-service is the sharpest case: the highest line coverage in the fleet
-- (99.6%, 37 test files) with nowhere to connect.
--
-- Convention mirrored from civitas_court / court_svc and bootstrap_inspection.sql:
--   role : NOSUPERUSER, NOCREATEDB, NOCREATEROLE, LOGIN, NOBYPASSRLS
--   db   : owned by civitas_admin, UTF8, PUBLIC revoked, CONNECT granted
--   privs: USAGE + DML on every non-system schema; ownership stays with
--          civitas_admin so migrations are admin-run and a service cannot ALTER
--          its own tables.
--
-- NOBYPASSRLS is load-bearing: the L3 lane asserts that no *_svc role can bypass
-- row-level security, which is what keeps tenant isolation enforced by the
-- database rather than only by application code.
--
-- Rollback:
--   DROP DATABASE IF EXISTS civitas_revenue;  DROP ROLE IF EXISTS revenue_svc;
--   DROP DATABASE IF EXISTS civitas_works;    DROP ROLE IF EXISTS works_svc;
--   DROP DATABASE IF EXISTS civitas_ml;       DROP ROLE IF EXISTS ml_svc;
--
-- Idempotent. Run as civitas_admin against the `postgres` database. Migrations
-- are applied separately, as admin; then re-run the grant block at the end
-- against each database.

-- ── Login roles ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('revenue_svc', 'revenue_dev_pw'),
      ('works_svc',   'works_dev_pw'),
      ('ml_svc',      'ml_dev_pw')
    ) AS t(rolename, pw)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r.rolename) THEN
      EXECUTE format(
        'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS INHERIT',
        r.rolename, r.pw);
    ELSE
      -- Re-assert the security-relevant attributes in case they drifted.
      EXECUTE format(
        'ALTER ROLE %I NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS LOGIN',
        r.rolename);
    END IF;
  END LOOP;
END
$$;

-- ── Databases ────────────────────────────────────────────────────────────────
-- CREATE DATABASE cannot run in a transaction or a DO body, so \gexec emits the
-- statement only when the database is absent.
SELECT 'CREATE DATABASE civitas_revenue OWNER civitas_admin ENCODING ''UTF8'''
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'civitas_revenue')
\gexec

SELECT 'CREATE DATABASE civitas_works OWNER civitas_admin ENCODING ''UTF8'''
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'civitas_works')
\gexec

SELECT 'CREATE DATABASE civitas_ml OWNER civitas_admin ENCODING ''UTF8'''
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'civitas_ml')
\gexec

-- ── Connect privileges ───────────────────────────────────────────────────────
REVOKE ALL ON DATABASE civitas_revenue FROM PUBLIC;
GRANT CONNECT ON DATABASE civitas_revenue TO revenue_svc;

REVOKE ALL ON DATABASE civitas_works FROM PUBLIC;
GRANT CONNECT ON DATABASE civitas_works TO works_svc;

REVOKE ALL ON DATABASE civitas_ml FROM PUBLIC;
GRANT CONNECT ON DATABASE civitas_ml TO ml_svc;
