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

-- PERF-014 (pgbouncer auth_query grant)
-- PERF-001's PgBouncer deployment (infra/pgbouncer/pgbouncer.ini, the
-- docker-compose pgbouncer service, infra/onprem/helm's pgbouncer.yaml)
-- connects as civitas_admin and runs
--
--     auth_query = SELECT rolname, rolpassword FROM pg_authid WHERE rolname=$1
--
-- civitas_admin is deliberately NOSUPERUSER (see above), and pg_authid grants
-- nothing to non-superuser roles by default, so on a fresh cluster that query
-- fails with
--
--     ERROR:  permission denied for table pg_authid
--
-- the instant PgBouncer tries to authenticate ANY role through it — this
-- role's own login included, since PgBouncer needs a working auth_query
-- connection before it can serve any client. Nothing in this repo's
-- bootstrap SQL granted it anywhere; the same "worked on the dev host from
-- an undocumented manual step, long ago, outside version control" pattern
-- this file was written to fix for role-creation itself (see the header
-- above) — PgBouncer's own live verification for PERF-001 almost certainly
-- ran against a host that already had this grant from earlier undocumented
-- setup. Reproduced end-to-end: fresh `postgres:16-alpine` bootstrap + a
-- real PgBouncer instance running this repo's actual auth_query config,
-- confirmed failing with the exact error above, then succeeding once this
-- grant is present — no manual step.
--
-- SELECT only, and only this table: PgBouncer's auth_query never needs more
-- than rolname/rolpassword, and civitas_admin must not become a way to read
-- out unrelated system state. rolpassword holds SCRAM verifiers (salted
-- hashes), not plaintext credentials, matching what auth_query itself
-- selects and what this grant exposes.
--
-- \c postgres below is NOT cosmetic. pg_authid is a shared catalog — its ROWS
-- are one cluster-wide set, identical from every database — but its ACL is
-- NOT: GRANT/REVOKE on a shared catalog writes to the CONNECTED database's
-- own pg_class.relacl, so the grant is only visible from whichever database
-- you were connected to when you ran it. Confirmed empirically: granting
-- while connected to civitas_test left civitas_admin able to read pg_authid
-- from civitas_test but still `permission denied` from postgres or any other
-- database on the exact same cluster. This script's own caller sets
-- $PGDATABASE to whatever the invoking environment wants (bootstrap-postgres.sh
-- defaults it to postgres, but its own documented throwaway-container example
-- further down that same file overrides it to civitas_test) — so this file
-- cannot assume it is already connected to the right one. PgBouncer's
-- auth_query always runs against auth_dbname = postgres (infra/pgbouncer/
-- pgbouncer.ini), so that is the one database this grant must land in,
-- independent of whatever database this script was invoked against.
--
-- Idempotent: GRANT is a no-op re-assertion if already held; \c postgres
-- reconnects with the same role, so no separate credential is needed.
\c postgres
GRANT SELECT ON pg_authid TO civitas_admin;
