-- bootstrap_municipal_services.sql
--
-- Purpose: create the {name}_svc role + civitas_{name} database for the 6
-- municipal Sec5 services that had real migrations
-- (services/<name>-service/migrations/) but no role/database in any
-- bootstrap file, so scripts/ci/bootstrap-postgres.sh's SERVICE_DBS-driven
-- migration loop could never reach them on a fresh CI Postgres — the exact
-- same "role/database never created in CI" gap already fixed elsewhere in
-- this directory (bootstrap_shop.sql, bootstrap_swm.sql,
-- bootstrap_sec5_batch3.sql, etc.) for their sibling municipal services.
--
-- advertisement-service, vendor-service, animal-service: role/db had only
-- ever been created by hand directly against a running container (see
-- provision-sec5-batch2-roles.sql's own comment describing this same
-- anti-pattern for these three) — invisible on fresh dev machines and in CI.
--
-- trade-service, parks-service, roadcut-service: role/db existed only in
-- scripts/dev/provision-sec5-batch2-roles.sql, a LOCAL-ONLY dev script never
-- invoked by CI (see scripts/ci/bootstrap-postgres.sh). Naming here matches
-- that file's convention exactly (<name>_svc / civitas_<name> /
-- <name>_dev_pw).
--
-- Schema creation is NOT done here: every one of these 6 services'
-- migrations/0001_initial.sql already does its own CREATE SCHEMA IF NOT
-- EXISTS (owned by the migration-running role, which is the database owner
-- below) — same division of responsibility as bootstrap_shop.sql.
--
-- Idempotent; safe to re-run.

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'advertisement_svc') THEN
    CREATE ROLE advertisement_svc WITH LOGIN PASSWORD 'advertisement_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_advertisement OWNER advertisement_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_advertisement') \gexec

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vendor_svc') THEN
    CREATE ROLE vendor_svc WITH LOGIN PASSWORD 'vendor_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_vendor OWNER vendor_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_vendor') \gexec

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'animal_svc') THEN
    CREATE ROLE animal_svc WITH LOGIN PASSWORD 'animal_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_animal OWNER animal_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_animal') \gexec

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'trade_svc') THEN
    CREATE ROLE trade_svc WITH LOGIN PASSWORD 'trade_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_trade OWNER trade_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_trade') \gexec

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'parks_svc') THEN
    CREATE ROLE parks_svc WITH LOGIN PASSWORD 'parks_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_parks OWNER parks_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_parks') \gexec

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'roadcut_svc') THEN
    CREATE ROLE roadcut_svc WITH LOGIN PASSWORD 'roadcut_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_roadcut OWNER roadcut_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_roadcut') \gexec
