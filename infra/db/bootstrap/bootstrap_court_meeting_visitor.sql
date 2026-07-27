-- bootstrap_court_meeting_visitor.sql
--
-- Purpose: provision the login roles and databases for court-service,
-- meeting-service and visitor-service.
--
-- DEFECT THIS FIXES (P0, CI)
-- None of the three appeared in ANY bootstrap file. `grep -rn "CREATE DATABASE
-- civitas_court" infra/db/bootstrap/ scripts/ci/` returned nothing, and the same
-- for civitas_meeting and civitas_visitor. All three are declared in
-- ecosystem.config.js, both are routed in the gateway registry, and both were
-- brought up and verified serving on 2026-07-27 — but on a fresh cluster their
-- databases simply do not exist, so nothing about them can be tested in CI.
-- Confirmed by running scripts/ci/bootstrap-postgres.sh against a throwaway
-- postgres:16-alpine container: the schema-drift guard reported civitas_meeting
-- and civitas_visitor as UNREACHABLE, and all 14 court-service migrations failed
-- because civitas_court did not exist.
--
-- They work on developer machines because their roles and databases were created
-- there by hand, outside version control.
--
-- Ownership follows what was observed on the dev cluster, per service:
--   civitas_meeting, civitas_visitor -> owned by their service role
--   civitas_court                    -> owned by civitas_admin (admin-run
--                                       migrations; the service role gets only
--                                       USAGE + DML via grant_service_schemas.sql)
-- court's own migrations issue CREATE SCHEMA for court/_outbox/_inbox, so this
-- file provisions only the role and the database for it.
--
-- Roles are NOBYPASSRLS so FORCE ROW LEVEL SECURITY binds them — the L3 lane
-- asserts no `%_svc` role can bypass RLS.
--
-- Rollback:
--   DROP DATABASE IF EXISTS civitas_meeting; DROP ROLE IF EXISTS meeting_svc;
--   DROP DATABASE IF EXISTS civitas_visitor; DROP ROLE IF EXISTS visitor_svc;
--   (Destructive. Do not run against a populated cluster.)
--
-- Idempotent: safe to re-run. Run as a superuser against the maintenance DB.

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'meeting_svc') THEN
    CREATE ROLE meeting_svc WITH LOGIN PASSWORD 'meeting_dev_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  ELSE
    ALTER ROLE meeting_svc NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'visitor_svc') THEN
    CREATE ROLE visitor_svc WITH LOGIN PASSWORD 'visitor_dev_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  ELSE
    ALTER ROLE visitor_svc NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS LOGIN;
  END IF;
END $$;

-- CREATE DATABASE cannot run inside a transaction or a PL/pgSQL block, so it is
-- issued through \gexec — the pattern the other bootstrap files use.
SELECT 'CREATE DATABASE civitas_meeting OWNER meeting_svc ENCODING ''UTF8'''
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_meeting')\gexec
SELECT 'CREATE DATABASE civitas_visitor OWNER visitor_svc ENCODING ''UTF8'''
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_visitor')\gexec

GRANT CONNECT ON DATABASE civitas_meeting TO meeting_svc;
GRANT CONNECT ON DATABASE civitas_visitor TO visitor_svc;

\connect civitas_meeting
REVOKE ALL ON SCHEMA public FROM PUBLIC;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS meeting AUTHORIZATION meeting_svc;
CREATE SCHEMA IF NOT EXISTS _outbox AUTHORIZATION meeting_svc;  -- transactional outbox
CREATE SCHEMA IF NOT EXISTS _inbox  AUTHORIZATION meeting_svc;  -- consumer idempotency

\connect civitas_visitor
REVOKE ALL ON SCHEMA public FROM PUBLIC;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS visitor AUTHORIZATION visitor_svc;
CREATE SCHEMA IF NOT EXISTS _outbox AUTHORIZATION visitor_svc;
CREATE SCHEMA IF NOT EXISTS _inbox  AUTHORIZATION visitor_svc;

-- ── court ────────────────────────────────────────────────────────────────────
-- Back to the maintenance database: the sections above left the session connected
-- to civitas_visitor, and CREATE DATABASE is clearer issued from `postgres`.
\connect postgres
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'court_svc') THEN
    CREATE ROLE court_svc WITH LOGIN PASSWORD 'court_dev_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  ELSE
    ALTER ROLE court_svc NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS LOGIN;
  END IF;
END $$;

SELECT 'CREATE DATABASE civitas_court OWNER civitas_admin ENCODING ''UTF8'''
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_court')\gexec

GRANT CONNECT ON DATABASE civitas_court TO court_svc;

\connect civitas_court
REVOKE ALL ON SCHEMA public FROM PUBLIC;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- Schemas are created by court-service's own migrations, which run as
-- civitas_admin from the ADMIN_OWNED_DBS loop in scripts/ci/bootstrap-postgres.sh.

-- ── gateway ──────────────────────────────────────────────────────────────────
-- gateway-service is mostly a reverse proxy, but its catalogue module is real:
-- services/gateway-service/migrations/0001_api_catalogue.sql documents "DB
-- civitas_gateway, role gateway_svc", and app.ts mounts the catalogue routes when
-- DATABASE_URL is set. Neither the role nor the database appeared in any bootstrap
-- file, so on a fresh cluster the schema-drift guard reported civitas_gateway as
-- UNREACHABLE and the catalogue routes could never be exercised in CI. The dev
-- cluster has it (owner=gateway_svc), created by hand.
\connect postgres
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'gateway_svc') THEN
    CREATE ROLE gateway_svc WITH LOGIN PASSWORD 'gateway_dev_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  ELSE
    ALTER ROLE gateway_svc NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS LOGIN;
  END IF;
END $$;

SELECT 'CREATE DATABASE civitas_gateway OWNER gateway_svc ENCODING ''UTF8'''
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_gateway')\gexec

GRANT CONNECT ON DATABASE civitas_gateway TO gateway_svc;

\connect civitas_gateway
REVOKE ALL ON SCHEMA public FROM PUBLIC;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS catalogue AUTHORIZATION gateway_svc;
CREATE SCHEMA IF NOT EXISTS _outbox   AUTHORIZATION gateway_svc;
CREATE SCHEMA IF NOT EXISTS _inbox    AUTHORIZATION gateway_svc;
