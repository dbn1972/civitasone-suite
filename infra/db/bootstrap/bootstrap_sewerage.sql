-- Bootstrap for sewerage-service (test-debt closure pass, 2026-09-03/04).
-- Run as civitas_admin (superuser in CI). Idempotent.
--
-- Why this exists: bootstrap-postgres.sh's SERVICE_DBS map (and every
-- infra/db/bootstrap/*.sql file) had no entry for sewerage-service at all --
-- the exact same "role/database never created" gap already fixed here for
-- cdp/catalogue/loyalty/journey and the sec5-batch3 services. Without this,
-- a fresh CI/dev Postgres container has no civitas_sewerage database or
-- sewerage_svc role, so sewerage-service's migration (added in this same
-- change; see services/sewerage-service/migrations/0001_initial.sql) would
-- fail outright with "database does not exist" the moment CI tried to apply
-- it, and the service could never be tested at all.

\connect postgres
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sewerage_svc') THEN
    CREATE ROLE sewerage_svc WITH LOGIN PASSWORD 'sewerage_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_sewerage OWNER sewerage_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_sewerage') \gexec
\connect civitas_sewerage
CREATE SCHEMA IF NOT EXISTS civitas_sewerage AUTHORIZATION sewerage_svc;
CREATE SCHEMA IF NOT EXISTS _outbox          AUTHORIZATION sewerage_svc;
CREATE SCHEMA IF NOT EXISTS _inbox           AUTHORIZATION sewerage_svc;
GRANT ALL ON SCHEMA civitas_sewerage TO sewerage_svc;
GRANT ALL ON SCHEMA _outbox          TO sewerage_svc;
GRANT ALL ON SCHEMA _inbox           TO sewerage_svc;
