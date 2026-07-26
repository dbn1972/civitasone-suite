-- Bootstrap for metadata-service (run as civitas_admin).
-- The metadata-service was previously a schema-only stub with no database; making
-- it a real runnable service requires its own DB-per-service with a NOBYPASSRLS
-- owner role so RLS (ENABLE + FORCE on every metadata table) is enforced at runtime.

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'metadata_svc') THEN
    CREATE ROLE metadata_svc WITH LOGIN PASSWORD 'metadata_dev_pw' NOBYPASSRLS;
  ELSE
    ALTER ROLE metadata_svc NOBYPASSRLS;
  END IF;
END $$;

SELECT 'CREATE DATABASE civitas_metadata OWNER metadata_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_metadata') \gexec

\connect civitas_metadata
CREATE SCHEMA IF NOT EXISTS metadata AUTHORIZATION metadata_svc;
CREATE SCHEMA IF NOT EXISTS _outbox  AUTHORIZATION metadata_svc;
CREATE SCHEMA IF NOT EXISTS _inbox   AUTHORIZATION metadata_svc;
GRANT ALL ON SCHEMA metadata, _outbox, _inbox TO metadata_svc;
