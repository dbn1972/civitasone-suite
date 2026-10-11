-- bootstrap_smarttransfer.sql
--
-- Purpose: create the smarttransfer_svc role + civitas_smarttransfer database
-- for the new SmartTransfer service (ST-M01-12).
--
-- smarttransfer-service is a new DB-backed Fastify service (database-per-service,
-- docs/ARCHITECTURE.md §5): own schema `smarttransfer`, own role
-- smarttransfer_svc, port 3086, routed at /api/v1/smarttransfer in the gateway
-- registry and run as a PM2 app + worker. Like every other service, its
-- role/database must exist before scripts/ci/bootstrap-postgres.sh's SERVICE_DBS
-- loop applies services/smarttransfer-service/migrations/0001_init.sql — on a
-- fresh CI Postgres the migration would otherwise fail to even authenticate
-- (role does not exist). Same pattern as bootstrap_building.sql /
-- bootstrap_shop.sql.
--
-- Schema creation is NOT done here: 0001_init.sql does CREATE SCHEMA IF NOT
-- EXISTS smarttransfer itself — this file only creates a database it can
-- connect to.
--
-- Idempotent; safe to re-run.

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'smarttransfer_svc') THEN
    CREATE ROLE smarttransfer_svc WITH LOGIN PASSWORD 'smarttransfer_dev_pw';
  END IF;
END $$;

SELECT 'CREATE DATABASE civitas_smarttransfer OWNER smarttransfer_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_smarttransfer') \gexec
