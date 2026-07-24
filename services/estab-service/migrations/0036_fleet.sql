-- Migration: 0036_fleet.sql
-- Purpose: Create fleet schema with fuel_logs, trip_logs, vehicle_documents, driver_roster tables (SVC-059).
-- Rollback: DROP SCHEMA fleet CASCADE; (destructive — requires DBA approval)
-- Affected services: estab-service (fleet module)

SET lock_timeout = '5s';

-- ── Schema ───────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS fleet;

-- ── fuel_logs ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fleet.fuel_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  vehicle_id    uuid NOT NULL,
  log_date      date NOT NULL,
  fuel_type     varchar(16) NOT NULL,
  litres        numeric(10, 2) NOT NULL,
  cost_minor    bigint NOT NULL,
  currency      char(3) NOT NULL DEFAULT 'INR',
  odometer_km   integer NOT NULL,
  pump_name     text,
  receipt_ref   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  version       integer NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fuel_logs_tenant_vehicle
  ON fleet.fuel_logs (tenant_id, vehicle_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fuel_logs_tenant_log_date
  ON fleet.fuel_logs (tenant_id, log_date);

-- ── trip_logs ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fleet.trip_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  vehicle_id      uuid NOT NULL,
  driver_id       uuid,
  trip_date       date NOT NULL,
  start_odometer  integer NOT NULL,
  end_odometer    integer,
  start_time      timestamptz NOT NULL,
  end_time        timestamptz,
  purpose         text NOT NULL,
  passenger_name  text,
  route           text,
  status          varchar(24) NOT NULL DEFAULT 'in_progress',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  updated_by      uuid NOT NULL,
  version         integer NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trip_logs_tenant_vehicle
  ON fleet.trip_logs (tenant_id, vehicle_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trip_logs_tenant_trip_date
  ON fleet.trip_logs (tenant_id, trip_date);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trip_logs_tenant_driver
  ON fleet.trip_logs (tenant_id, driver_id);

-- ── vehicle_documents ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fleet.vehicle_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  vehicle_id    uuid NOT NULL,
  doc_type      varchar(32) NOT NULL,
  doc_number    text,
  issued_at     date,
  valid_from    date NOT NULL,
  valid_until   date NOT NULL,
  issuer        text,
  amount_minor  bigint,
  currency      char(3) NOT NULL DEFAULT 'INR',
  status        varchar(24) NOT NULL DEFAULT 'active',
  reminder_sent boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  updated_by    uuid NOT NULL,
  version       integer NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicle_docs_tenant_vehicle
  ON fleet.vehicle_documents (tenant_id, vehicle_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicle_docs_tenant_valid_until
  ON fleet.vehicle_documents (tenant_id, valid_until);

-- ── driver_roster ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fleet.driver_roster (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  driver_id   uuid NOT NULL,
  vehicle_id  uuid,
  shift_date  date NOT NULL,
  shift_type  varchar(16) NOT NULL DEFAULT 'day',
  status      varchar(24) NOT NULL DEFAULT 'scheduled',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NOT NULL,
  updated_by  uuid NOT NULL,
  version     integer NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_driver_roster_tenant_driver_date
  ON fleet.driver_roster (tenant_id, driver_id, shift_date);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_driver_roster_tenant_vehicle
  ON fleet.driver_roster (tenant_id, vehicle_id);

-- ── RLS policies ─────────────────────────────────────────────────────────────

ALTER TABLE fleet.fuel_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.trip_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.vehicle_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.driver_roster ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'fuel_logs_tenant_isolation') THEN
    EXECUTE 'CREATE POLICY fuel_logs_tenant_isolation ON fleet.fuel_logs USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'trip_logs_tenant_isolation') THEN
    EXECUTE 'CREATE POLICY trip_logs_tenant_isolation ON fleet.trip_logs USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'vehicle_documents_tenant_isolation') THEN
    EXECUTE 'CREATE POLICY vehicle_documents_tenant_isolation ON fleet.vehicle_documents USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'driver_roster_tenant_isolation') THEN
    EXECUTE 'CREATE POLICY driver_roster_tenant_isolation ON fleet.driver_roster USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)';
  END IF;
END $$;
