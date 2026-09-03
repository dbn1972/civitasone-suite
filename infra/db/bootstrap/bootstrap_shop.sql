-- bootstrap_shop.sql
--
-- Purpose: create the shop_svc role + civitas_shop database.
--
-- DEFECT THIS FIXES: shop-service (shop & establishment licensing) has real
-- migrations (services/shop-service/migrations/) and is wired into the local
-- dev tooling — scripts/dev/grant-all.mjs and scripts/dev/migrate-all.mjs both
-- know shop_svc/civitas_shop (added for the Sec5 batch 2 services: parks,
-- refund, roadcut, shop, trade — see scripts/dev/provision-sec5-batch2-roles.sql,
-- a LOCAL-ONLY dev script) — but no bootstrap file here ever created shop_svc
-- or civitas_shop, and shop-service was never added to bootstrap-postgres.sh's
-- SERVICE_DBS map. So on a fresh CI Postgres, every shop-service migration
-- fails to even authenticate (role does not exist, indistinguishable from a
-- wrong password), and shop-service's tests can never run in CI. Confirmed
-- absent by grepping civitas_shop/shop_svc across every infra/db/bootstrap/*.sql
-- file before adding this one — same class of gap as bootstrap_refund.sql
-- (refund-service) fixed for the same batch.
--
-- Schema creation is NOT done here: services/shop-service/migrations/
-- 0001_initial.sql already does CREATE SCHEMA IF NOT EXISTS shop itself — it
-- only needs a database it can connect to in order to do that.
--
-- Idempotent; safe to re-run.

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'shop_svc') THEN
    CREATE ROLE shop_svc WITH LOGIN PASSWORD 'shop_dev_pw';
  END IF;
END $$;

SELECT 'CREATE DATABASE civitas_shop OWNER shop_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_shop') \gexec
