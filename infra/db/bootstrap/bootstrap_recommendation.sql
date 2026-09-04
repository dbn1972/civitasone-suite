-- bootstrap_recommendation.sql
--
-- Purpose: create the recommendation_svc role + civitas_recommendation database.
--
-- DEFECT THIS FIXES: recommendation-service (customer-engagement platform)
-- has real migrations (services/recommendation-service/migrations/, 8 files)
-- and 15 test files / 1172 tests that already pass cleanly once a database is
-- manually provisioned, but no bootstrap file here ever created
-- recommendation_svc or civitas_recommendation, and recommendation-service
-- was never added to bootstrap-postgres.sh's SERVICE_DBS map — even though
-- scripts/dev/migrate-all.mjs already lists it (civitas_recommendation).
-- Same class of gap bootstrap_shop.sql / bootstrap_parks.sql fixed for their
-- services. Confirmed absent by grepping civitas_recommendation/
-- recommendation_svc across every infra/db/bootstrap/*.sql file before adding
-- this one.
--
-- Schema creation is NOT done here: services/recommendation-service/
-- migrations/0001_recommendation_foundation.sql already does
-- CREATE SCHEMA IF NOT EXISTS recommendation itself, and grants to
-- recommendation_svc are guarded on the role already existing — it only
-- needs a database + login role to connect with.
--
-- Idempotent; safe to re-run.

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'recommendation_svc') THEN
    CREATE ROLE recommendation_svc WITH LOGIN PASSWORD 'recommendation_dev_pw';
  END IF;
END $$;

SELECT 'CREATE DATABASE civitas_recommendation OWNER recommendation_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_recommendation') \gexec
