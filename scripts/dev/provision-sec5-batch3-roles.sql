-- provision-sec5-batch3-roles.sql
--
-- Creates the Postgres login roles + databases for the 6 municipal Sec5
-- services covered by the 2026-08-27 deep-verification pass (crematorium,
-- drainage, event, fire, market, parking). Idempotent (safe to re-run).
--
-- Why this exists: same gap as provision-sec5-batch2-roles.sql fixed for
-- parks/refund/roadcut/shop/trade -- migrate-all.mjs and grant-all.mjs now
-- both have entries for this batch (see the "Municipal Sec5 batch 3" blocks
-- added to each), but nothing in version control creates the underlying
-- roles/databases those two scripts assume already exist. On a genuinely
-- fresh database, migrate-all.mjs would fail immediately with
-- "database \"civitas_drainage\" does not exist" (and likewise for the other
-- 5) before ever reaching the fix either script applies.
--
-- Deliberately does NOT create schemas/tables/grants: those come from
-- migrate-all.mjs and grant-all.mjs respectively, exactly as batch 2's script
-- documents. Password convention matches ecosystem.config.js's dbUrl() dev
-- default: {role} with "_svc" replaced by "_dev_pw".
--
-- Usage: docker exec -i civitasone-postgres psql -U civitas_admin -d postgres -v ON_ERROR_STOP=1 < provision-sec5-batch3-roles.sql

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'crematorium_svc') THEN
    CREATE ROLE crematorium_svc WITH LOGIN PASSWORD 'crematorium_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_crematorium OWNER crematorium_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_crematorium') \gexec

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'drainage_svc') THEN
    CREATE ROLE drainage_svc WITH LOGIN PASSWORD 'drainage_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_drainage OWNER drainage_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_drainage') \gexec

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'event_svc') THEN
    CREATE ROLE event_svc WITH LOGIN PASSWORD 'event_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_event OWNER event_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_event') \gexec

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fire_svc') THEN
    CREATE ROLE fire_svc WITH LOGIN PASSWORD 'fire_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_fire OWNER fire_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_fire') \gexec

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'market_svc') THEN
    CREATE ROLE market_svc WITH LOGIN PASSWORD 'market_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_market OWNER market_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_market') \gexec

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'parking_svc') THEN
    CREATE ROLE parking_svc WITH LOGIN PASSWORD 'parking_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_parking OWNER parking_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_parking') \gexec
