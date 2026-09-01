-- bootstrap_refund.sql
--
-- Purpose: create the refund_svc role + civitas_refund database.
--
-- DEFECT THIS FIXES: refund-service was added to bootstrap-postgres.sh's
-- SERVICE_DBS map (see the comment there: "refund-service: migrations
-- directory lands with PR #777 ... so refund-service's DB-integration tests
-- can actually run"), but no bootstrap file ever created refund_svc or
-- civitas_refund. Every refund-service migration therefore failed to even
-- authenticate — Postgres reports a nonexistent role the same way it reports
-- a wrong password ("password authentication failed"), which is why this
-- looked like a credential mismatch rather than a missing-role gap.
--
-- Schema creation is NOT done here: services/refund-service/migrations/
-- 0001_initial.sql already does `CREATE SCHEMA IF NOT EXISTS refund/_outbox/
-- _inbox` itself (works-service pattern, single schema per DB) — it only
-- needs a database it owns to do that in.
--
-- Idempotent; safe to re-run.

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'refund_svc') THEN
    CREATE ROLE refund_svc WITH LOGIN PASSWORD 'refund_dev_pw';
  END IF;
END $$;

SELECT 'CREATE DATABASE civitas_refund OWNER refund_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_refund') \gexec
