-- Bootstrap for the 6 municipal Sec5 batch-3 services (2026-08-27
-- deep-verification pass): crematorium, drainage, event, fire, market,
-- parking. Run as civitas_admin. Idempotent.
--
-- Why this exists: bootstrap-postgres.sh's existing chain (bootstrap.
-- generated.sql, bootstrap_new_services.sql, bootstrap_remaining_services.sql,
-- bootstrap_missing_services.sql, etc.) has no entry for any of these 6 --
-- the exact same "role/database never created in CI" gap those files
-- document fixing for crm/analytics/helpdesk/etc. Without this, CI's fresh
-- Postgres container has no civitas_<svc> database or <svc>_svc role for any
-- of these 6, so their migrations (already wired into scripts/dev/
-- migrate-all.mjs and scripts/dev/grant-all.mjs for local dev -- see PR #830
-- and its follow-up) would fail outright in CI with "database does not
-- exist" the moment any of their test suites try to connect.
--
-- fire-service uses 4 per-module schemas (fire_applications/inspections/
-- lifecycle/nocs) rather than one matching its own service name; drainage-
-- service's migration creates a schema literally named civitas_drainage
-- (matching its own database name, not the short "drainage" form its 5
-- siblings use) -- both are pre-existing, already-flagged naming
-- inconsistencies from services/*/migrations/0001_initial.sql, reproduced
-- here exactly as those migrations define them, not corrected.

-- ── crematorium ──────────────────────────────────────────────────
\connect postgres
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'crematorium_svc') THEN
    CREATE ROLE crematorium_svc WITH LOGIN PASSWORD 'crematorium_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_crematorium OWNER crematorium_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_crematorium') \gexec
\connect civitas_crematorium
CREATE SCHEMA IF NOT EXISTS crematorium AUTHORIZATION crematorium_svc;
CREATE SCHEMA IF NOT EXISTS _outbox     AUTHORIZATION crematorium_svc;
CREATE SCHEMA IF NOT EXISTS _inbox      AUTHORIZATION crematorium_svc;
GRANT ALL ON SCHEMA crematorium TO crematorium_svc;
GRANT ALL ON SCHEMA _outbox     TO crematorium_svc;
GRANT ALL ON SCHEMA _inbox      TO crematorium_svc;

-- ── drainage ─────────────────────────────────────────────────────
\connect postgres
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'drainage_svc') THEN
    CREATE ROLE drainage_svc WITH LOGIN PASSWORD 'drainage_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_drainage OWNER drainage_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_drainage') \gexec
\connect civitas_drainage
CREATE SCHEMA IF NOT EXISTS civitas_drainage AUTHORIZATION drainage_svc;
CREATE SCHEMA IF NOT EXISTS _outbox          AUTHORIZATION drainage_svc;
CREATE SCHEMA IF NOT EXISTS _inbox           AUTHORIZATION drainage_svc;
GRANT ALL ON SCHEMA civitas_drainage TO drainage_svc;
GRANT ALL ON SCHEMA _outbox          TO drainage_svc;
GRANT ALL ON SCHEMA _inbox           TO drainage_svc;

-- ── event ────────────────────────────────────────────────────────
\connect postgres
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'event_svc') THEN
    CREATE ROLE event_svc WITH LOGIN PASSWORD 'event_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_event OWNER event_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_event') \gexec
\connect civitas_event
CREATE SCHEMA IF NOT EXISTS event   AUTHORIZATION event_svc;
CREATE SCHEMA IF NOT EXISTS _outbox AUTHORIZATION event_svc;
CREATE SCHEMA IF NOT EXISTS _inbox  AUTHORIZATION event_svc;
GRANT ALL ON SCHEMA event   TO event_svc;
GRANT ALL ON SCHEMA _outbox TO event_svc;
GRANT ALL ON SCHEMA _inbox  TO event_svc;

-- ── fire (4 per-module schemas, not 1) ──────────────────────────
\connect postgres
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fire_svc') THEN
    CREATE ROLE fire_svc WITH LOGIN PASSWORD 'fire_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_fire OWNER fire_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_fire') \gexec
\connect civitas_fire
CREATE SCHEMA IF NOT EXISTS fire_applications AUTHORIZATION fire_svc;
CREATE SCHEMA IF NOT EXISTS fire_inspections  AUTHORIZATION fire_svc;
CREATE SCHEMA IF NOT EXISTS fire_lifecycle    AUTHORIZATION fire_svc;
CREATE SCHEMA IF NOT EXISTS fire_nocs         AUTHORIZATION fire_svc;
CREATE SCHEMA IF NOT EXISTS _outbox           AUTHORIZATION fire_svc;
CREATE SCHEMA IF NOT EXISTS _inbox            AUTHORIZATION fire_svc;
GRANT ALL ON SCHEMA fire_applications TO fire_svc;
GRANT ALL ON SCHEMA fire_inspections  TO fire_svc;
GRANT ALL ON SCHEMA fire_lifecycle    TO fire_svc;
GRANT ALL ON SCHEMA fire_nocs         TO fire_svc;
GRANT ALL ON SCHEMA _outbox           TO fire_svc;
GRANT ALL ON SCHEMA _inbox            TO fire_svc;

-- ── market ───────────────────────────────────────────────────────
\connect postgres
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'market_svc') THEN
    CREATE ROLE market_svc WITH LOGIN PASSWORD 'market_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_market OWNER market_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_market') \gexec
\connect civitas_market
CREATE SCHEMA IF NOT EXISTS market  AUTHORIZATION market_svc;
CREATE SCHEMA IF NOT EXISTS _outbox AUTHORIZATION market_svc;
CREATE SCHEMA IF NOT EXISTS _inbox  AUTHORIZATION market_svc;
GRANT ALL ON SCHEMA market  TO market_svc;
GRANT ALL ON SCHEMA _outbox TO market_svc;
GRANT ALL ON SCHEMA _inbox  TO market_svc;

-- ── parking ──────────────────────────────────────────────────────
\connect postgres
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'parking_svc') THEN
    CREATE ROLE parking_svc WITH LOGIN PASSWORD 'parking_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_parking OWNER parking_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_parking') \gexec
\connect civitas_parking
CREATE SCHEMA IF NOT EXISTS parking AUTHORIZATION parking_svc;
CREATE SCHEMA IF NOT EXISTS _outbox  AUTHORIZATION parking_svc;
CREATE SCHEMA IF NOT EXISTS _inbox   AUTHORIZATION parking_svc;
GRANT ALL ON SCHEMA parking TO parking_svc;
GRANT ALL ON SCHEMA _outbox TO parking_svc;
GRANT ALL ON SCHEMA _inbox  TO parking_svc;
