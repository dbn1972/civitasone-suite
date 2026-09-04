-- bootstrap_building.sql
--
-- Purpose: create the building_svc role + civitas_building database.
--
-- DEFECT THIS FIXES: building-service is live-routed via the gateway
-- (services/gateway-service/src/registry.ts, port 3071) and runs as a PM2
-- app+worker, but until this pass had no migration and no role/database
-- anywhere. scripts/ci/bootstrap-postgres.sh's SERVICE_DBS map and
-- scripts/dev/migrate-all.mjs already carry a building-service entry (added
-- by PR #1000 as a deliberate no-op via the migration loop's own
-- `[ -d "$mig_dir" ] || continue` guard) referencing building_svc/
-- civitas_building — but no bootstrap file anywhere ever created either one.
-- Grepped every infra/db/bootstrap/*.sql and scripts/*.sql for
-- "building_svc"/"civitas_building" before adding this file — confirmed
-- absent. Same class of gap bootstrap_shop.sql (shop-service) and
-- bootstrap_refund.sql (refund-service) fixed for their own services: on a
-- fresh CI Postgres, building-service's migration would fail to even
-- authenticate (role does not exist, indistinguishable from a wrong
-- password) once services/building-service/migrations/0001_init.sql lands.
--
-- Schema creation is NOT done here: services/building-service/migrations/
-- 0001_init.sql already does CREATE SCHEMA IF NOT EXISTS building itself —
-- this file only needs to create a database it can connect to.
--
-- Idempotent; safe to re-run.

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'building_svc') THEN
    CREATE ROLE building_svc WITH LOGIN PASSWORD 'building_dev_pw';
  END IF;
END $$;

SELECT 'CREATE DATABASE civitas_building OWNER building_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_building') \gexec
