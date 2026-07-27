-- grant_service_schemas.sql
--
-- Purpose: grant a service role USAGE + DML on every non-system schema in the
-- database it is run against, WITHOUT transferring ownership.
--
-- Run AFTER that service's migrations have created its schemas, as civitas_admin,
-- against the target database, passing the role name:
--
--   psql -U civitas_admin -d civitas_revenue \
--        -v svc_role=revenue_svc -f grant_service_schemas.sql
--
-- Ownership deliberately stays with civitas_admin so migrations are admin-run and
-- a service cannot ALTER its own tables. Re-run after any migration that adds a
-- schema. Idempotent.
--
-- Extracted from bootstrap_inspection.sql so the same logic is not copied per
-- service.

-- psql does NOT substitute :variables inside a dollar-quoted string, so the role
-- name is passed through a session GUC instead. set_config() sits outside the
-- dollar quotes, where interpolation does happen.
SELECT set_config('bootstrap.svc_role', :'svc_role', false);

DO $$
DECLARE
  s text;
  role_name text := current_setting('bootstrap.svc_role');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
    RAISE EXCEPTION 'role % does not exist — provision it before granting', role_name;
  END IF;

  FOR s IN
    SELECT nspname FROM pg_namespace
    WHERE nspname NOT LIKE 'pg_%' AND nspname NOT IN ('information_schema', 'public')
  LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', s, role_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO %I', s, role_name);
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO %I', s, role_name);
    -- Future objects created by civitas_admin in this schema.
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
      s, role_name);
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO %I',
      s, role_name);
  END LOOP;
END
$$;
