-- bootstrap_unregistered_services.sql
--
-- Purpose: create the role + database for four services that have real
-- migrations and test suites but were never added to bootstrap-postgres.sh's
-- SERVICE_DBS map: cdp-service, catalogue-service, loyalty-service,
-- journey-service. Every DB-touching test in these services' 37 test files
-- has never run in CI — connecting as a role that doesn't exist produces the
-- same "password authentication failed" Postgres gives for a wrong password
-- on an existing role, so this looked like scattered auth failures rather
-- than four whole services missing from bootstrap.
--
-- Schema creation is NOT done here: each service's own 0001 migration
-- already does `CREATE SCHEMA IF NOT EXISTS <name>` (same self-sufficient
-- pattern as refund-service, see bootstrap_refund.sql) — they only need a
-- database they own to do that in. Role/database names verified against
-- each service's vitest.config.ts / .env.example DATABASE_URL default.
--
-- Idempotent; safe to re-run.

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cdp_svc') THEN
    CREATE ROLE cdp_svc WITH LOGIN PASSWORD 'cdp_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_cdp OWNER cdp_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_cdp') \gexec

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'catalogue_svc') THEN
    CREATE ROLE catalogue_svc WITH LOGIN PASSWORD 'catalogue_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_catalogue OWNER catalogue_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_catalogue') \gexec

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'loyalty_svc') THEN
    CREATE ROLE loyalty_svc WITH LOGIN PASSWORD 'loyalty_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_loyalty OWNER loyalty_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_loyalty') \gexec

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'journey_svc') THEN
    CREATE ROLE journey_svc WITH LOGIN PASSWORD 'journey_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_journey OWNER journey_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_journey') \gexec
