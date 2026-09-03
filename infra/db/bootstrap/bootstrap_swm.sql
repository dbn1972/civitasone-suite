-- Bootstrap for swm-service (solid waste management).
-- Run as civitas_admin/superuser. Idempotent.
--
-- swm-service was routed in the gateway registry
-- (services/gateway-service/src/registry.ts:112, prefix /api/v1/swm) and had
-- 5 fully-implemented Drizzle table definitions across 4 modules
-- (complaints, bulk_generators, collection, analytics), but no role/database
-- was ever created for it in any bootstrap file — the same "declared but
-- never provisioned" gap this file's siblings (bootstrap_missing_services.sql,
-- bootstrap_sec5_batch3.sql, etc.) already fixed for their own batches.
-- Without this, swm-service's migrations
-- (services/swm-service/migrations/0001_swm_schema.sql,
-- 0002_swm_outbox_inbox.sql) fail with "database civitas_swm does not exist"
-- before the migration loop in scripts/ci/bootstrap-postgres.sh ever reaches
-- them.
--
-- Schema name matches modules/*/schema.ts's `pgSchema("civitas_swm")`
-- exactly (unlike most services, whose Drizzle schema name is shorter than
-- their database name — swm-service's migration author used the same string
-- for both).

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'swm_svc') THEN
    CREATE ROLE swm_svc WITH LOGIN PASSWORD 'swm_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_swm OWNER swm_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_swm') \gexec
\connect civitas_swm
CREATE SCHEMA IF NOT EXISTS civitas_swm AUTHORIZATION swm_svc;
CREATE SCHEMA IF NOT EXISTS _outbox     AUTHORIZATION swm_svc;
CREATE SCHEMA IF NOT EXISTS _inbox      AUTHORIZATION swm_svc;
GRANT ALL ON SCHEMA civitas_swm TO swm_svc;
GRANT ALL ON SCHEMA _outbox     TO swm_svc;
GRANT ALL ON SCHEMA _inbox      TO swm_svc;
