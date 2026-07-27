-- bootstrap_admin_role.sql
--
-- Purpose: create the `civitas_admin` role. Must run FIRST, before any other
-- bootstrap file.
--
-- DEFECT THIS FIXES (P0, CI)
-- No bootstrap file created this role, yet bootstrap_inspection.sql,
-- bootstrap_metadata.sql and grant_service_schemas.sql all depend on it. On a
-- fresh Postgres — which is exactly what the GitHub Actions service container
-- is — scripts/ci/bootstrap-postgres.sh therefore aborted with
--
--     ERROR:  role "civitas_admin" does not exist
--
-- at bootstrap_inspection.sql:55, and because that script runs under
-- `set -euo pipefail` with run_bootstrap using ON_ERROR_STOP=1, it exited 3
-- BEFORE APPLYING A SINGLE MIGRATION. Every step after it in the Integration
-- Tests job — the migrations, the schema drift guard, the integration tests
-- themselves — never ran against a populated database.
--
-- It was invisible on developer machines because civitas_admin was created there
-- by hand, long ago, outside version control. Reproduced by running the bootstrap
-- against a throwaway `postgres:16-alpine` container on port 5499.
--
-- Ownership model: civitas_admin owns the databases and schemas of services that
-- follow the admin-owned convention (inspection, metadata, court), so their
-- migrations are admin-run and the service role holds only USAGE + DML and cannot
-- ALTER its own tables. It is deliberately NOT a superuser and NOT BYPASSRLS —
-- the L3 lane asserts no `%_svc` role holds BYPASSRLS, and civitas_admin must not
-- become a hole in that.
--
-- Password comes from psql variable `admin_pw` so no credential is committed:
--     psql -v admin_pw="$POSTGRES_ADMIN_PASSWORD" -f bootstrap_admin_role.sql
--
-- Rollback:
--   REASSIGN OWNED BY civitas_admin TO <new_owner>; DROP OWNED BY civitas_admin;
--   DROP ROLE IF EXISTS civitas_admin;
--   (Destructive — it owns databases. Do not run against a populated cluster.)
--
-- Idempotent: safe to re-run. Re-running resets the password to `admin_pw`.

SELECT set_config('bootstrap.admin_pw', :'admin_pw', false);

DO $$
DECLARE pw text := current_setting('bootstrap.admin_pw');
BEGIN
  IF pw IS NULL OR length(pw) = 0 THEN
    RAISE EXCEPTION 'admin_pw must be supplied: psql -v admin_pw=... -f bootstrap_admin_role.sql';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'civitas_admin') THEN
    -- CREATEDB because it owns civitas_inspection and civitas_metadata.
    -- NOSUPERUSER + NOBYPASSRLS so RLS still binds it.
    EXECUTE format(
      'CREATE ROLE civitas_admin LOGIN CREATEDB NOSUPERUSER NOBYPASSRLS NOCREATEROLE PASSWORD %L', pw);
    RAISE NOTICE 'created role civitas_admin';
  ELSE
    EXECUTE format('ALTER ROLE civitas_admin LOGIN CREATEDB NOSUPERUSER NOBYPASSRLS PASSWORD %L', pw);
    RAISE NOTICE 'role civitas_admin already existed — attributes and password re-asserted';
  END IF;
END
$$;

-- The bootstrapping superuser must be able to hand databases to civitas_admin
-- (CREATE DATABASE ... OWNER civitas_admin requires membership unless superuser)
-- and civitas_admin must be able to see objects the superuser creates.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_auth_members m
      JOIN pg_roles r ON r.oid = m.roleid
      JOIN pg_roles g ON g.oid = m.member
     WHERE r.rolname = 'civitas_admin' AND g.rolname = current_user
  ) AND current_user <> 'civitas_admin' THEN
    EXECUTE format('GRANT civitas_admin TO %I', current_user);
    RAISE NOTICE 'granted civitas_admin to %', current_user;
  END IF;
END
$$;
