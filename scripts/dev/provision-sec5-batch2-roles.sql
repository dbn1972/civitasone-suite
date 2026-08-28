-- provision-sec5-batch2-roles.sql
--
-- Creates the Postgres login roles + databases for the 5 municipal Sec5
-- services covered by the 2026-08-27 deep-verification pass (parks, refund,
-- roadcut, shop, trade). Idempotent (safe to re-run).
--
-- Why this exists: civitas_advertisement/animal/vendor (the other 3 Sec5
-- services with migrations) had their roles/DBs created by hand directly
-- against the running container — "invisible on dev machines... outside
-- version control" per bootstrap-postgres.sh's own comment about the same
-- anti-pattern happening to civitas_admin. This script does the equivalent
-- step for the 5 batch-2 services but keeps it in version control, following
-- the idempotent CREATE ROLE / CREATE DATABASE idiom already established in
-- scripts/ci/bootstrap-remaining-services.sql.
--
-- Deliberately does NOT create schemas/tables/grants: for the Sec5 pattern
-- those come from migrate-all.mjs (runs as the civitas_admin superuser, so DB
-- ownership below doesn't gate it) and grant-all.mjs (post-migration schema
-- + table grants) respectively — see the entries added for these 5 in both
-- scripts. Password convention matches ecosystem.config.js's dbUrl() dev
-- default: {role} with "_svc" replaced by "_dev_pw".
--
-- Usage: docker exec -i civitasone-postgres psql -U civitas_admin -d postgres -v ON_ERROR_STOP=1 < provision-sec5-batch2-roles.sql

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'parks_svc') THEN
    CREATE ROLE parks_svc WITH LOGIN PASSWORD 'parks_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_parks OWNER parks_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_parks') \gexec

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'refund_svc') THEN
    CREATE ROLE refund_svc WITH LOGIN PASSWORD 'refund_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_refund OWNER refund_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_refund') \gexec

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'roadcut_svc') THEN
    CREATE ROLE roadcut_svc WITH LOGIN PASSWORD 'roadcut_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_roadcut OWNER roadcut_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_roadcut') \gexec

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'shop_svc') THEN
    CREATE ROLE shop_svc WITH LOGIN PASSWORD 'shop_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_shop OWNER shop_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_shop') \gexec

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'trade_svc') THEN
    CREATE ROLE trade_svc WITH LOGIN PASSWORD 'trade_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_trade OWNER trade_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_trade') \gexec
