-- bootstrap_field.sql
--
-- Purpose: create the field_svc role + civitas_field database.
--
-- DEFECT THIS FIXES (REL-006): field-service has real migrations
-- (services/field-service/migrations/, 2 files: 0001_field_foundation.sql,
-- 0002_outbox_inbox.sql) and is already wired into ecosystem.config.js as
-- both a worker("field", "field_svc", "civitas_field") and
-- svc("field", 3046, "field_svc", "civitas_field") -- and field_svc/
-- civitas_field are already listed in scripts/dev/provision-platform-roles.mjs
-- (role field_svc, schema field, envKey FIELD_DB_PASSWORD, default
-- field_dev_pw) and scripts/dev/migrate-all.mjs (civitas_field) for local
-- dev -- but no bootstrap file here ever created field_svc or civitas_field,
-- and field-service was never added to bootstrap-postgres.sh's SERVICE_DBS
-- map, so on a fresh CI Postgres its migrations fail to even authenticate
-- and its tests can never run against a real database in CI. Same class of
-- gap bootstrap_shop.sql, bootstrap_ai_agent.sql and
-- bootstrap_recommendation.sql fixed for their services. Confirmed absent by
-- grepping civitas_field/field_svc across every infra/db/bootstrap/*.sql
-- file before adding this one.
--
-- Schema creation is NOT done here: services/field-service/migrations/
-- 0001_field_foundation.sql already does CREATE SCHEMA IF NOT EXISTS field
-- itself (and 0002_outbox_inbox.sql creates the shared _outbox/_inbox
-- schemas); grants to field_svc are guarded on the role already existing --
-- it only needs a database + login role to connect with.
--
-- Password matches the `<role>_dev_pw` convention the migration loop in
-- bootstrap-postgres.sh derives automatically from the role name
-- (`field_svc` -> `field_dev_pw`), and the default already hardcoded in
-- scripts/dev/provision-platform-roles.mjs.
--
-- Idempotent; safe to re-run.

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'field_svc') THEN
    CREATE ROLE field_svc WITH LOGIN PASSWORD 'field_dev_pw';
  END IF;
END $$;

SELECT 'CREATE DATABASE civitas_field OWNER field_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_field') \gexec
