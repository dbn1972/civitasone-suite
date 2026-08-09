-- parking-service initial migration
-- Applied with parking_svc role on civitas_parking.
-- Generated from src/modules/*/schema.ts — do not invent columns beyond schema.

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS parking;

CREATE TABLE IF NOT EXISTS parking.parking_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  booking_number varchar(64) NOT NULL UNIQUE,
  facility_id uuid NOT NULL,
  vehicle_number varchar(20) NOT NULL,
  vehicle_type varchar(32) NOT NULL,
  entry_time timestamptz,
  exit_time timestamptz,
  duration_minutes integer,
  amount_minor bigint,
  currency varchar(3) NOT NULL DEFAULT 'INR',
  status varchar(32) NOT NULL DEFAULT 'booked',
  payment_ref text,
  space_number text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS parking.parking_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  violation_number varchar(64) NOT NULL UNIQUE,
  location jsonb,
  vehicle_number varchar(20) NOT NULL,
  violation_type varchar(32) NOT NULL,
  photo text,
  fine_minor bigint NOT NULL,
  currency varchar(3) NOT NULL DEFAULT 'INR',
  status varchar(32) NOT NULL DEFAULT 'issued',
  issued_by uuid NOT NULL,
  challan_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS parking.parking_facilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  facility_name text NOT NULL,
  facility_type varchar(32) NOT NULL,
  address jsonb NOT NULL,
  ward varchar(64),
  total_spaces integer NOT NULL,
  available_spaces integer NOT NULL,
  operating_hours jsonb,
  tariff_per_hour_minor bigint,
  tariff_per_day_minor bigint,
  monthly_pass_minor bigint,
  annual_pass_minor bigint,
  currency varchar(3) NOT NULL DEFAULT 'INR',
  status varchar(32) NOT NULL DEFAULT 'active',
  contact_person text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS parking.parking_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  pass_number varchar(64) NOT NULL UNIQUE,
  facility_id uuid NOT NULL,
  holder_name text NOT NULL,
  vehicle_number varchar(20) NOT NULL,
  vehicle_type varchar(32) NOT NULL,
  pass_type varchar(16) NOT NULL,
  valid_from date NOT NULL,
  valid_until date NOT NULL,
  amount_minor bigint NOT NULL,
  currency varchar(3) NOT NULL DEFAULT 'INR',
  status varchar(32) NOT NULL DEFAULT 'active',
  payment_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);


-- ── _outbox / _inbox (CQRS) ───────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS _outbox;
CREATE SCHEMA IF NOT EXISTS _inbox;

CREATE TABLE IF NOT EXISTS _outbox.messages (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  topic          varchar(128) NOT NULL,
  event_type     varchar(128) NOT NULL,
  tenant_id      uuid        NOT NULL,
  actor_id       uuid        NOT NULL,
  correlation_id varchar(64) NOT NULL,
  payload        jsonb       NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_outbox_unpublished
  ON _outbox.messages (created_at) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS _inbox.processed (
  message_id   uuid PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);

-- ── Row Level Security ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

ALTER TABLE parking.parking_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE parking.parking_bookings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON parking.parking_bookings;
CREATE POLICY tenant_isolation ON parking.parking_bookings
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE parking.parking_violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE parking.parking_violations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON parking.parking_violations;
CREATE POLICY tenant_isolation ON parking.parking_violations
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE parking.parking_facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE parking.parking_facilities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON parking.parking_facilities;
CREATE POLICY tenant_isolation ON parking.parking_facilities
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE parking.parking_passes ENABLE ROW LEVEL SECURITY;
ALTER TABLE parking.parking_passes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON parking.parking_passes;
CREATE POLICY tenant_isolation ON parking.parking_passes
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages;
CREATE POLICY tenant_isolation ON _outbox.messages
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── Grants ─────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'parking_svc') THEN
    GRANT USAGE ON SCHEMA _outbox TO parking_svc;
    GRANT USAGE ON SCHEMA _inbox TO parking_svc;
    GRANT SELECT, INSERT, UPDATE ON _outbox.messages TO parking_svc;
    GRANT SELECT, INSERT ON _inbox.processed TO parking_svc;
    GRANT USAGE ON SCHEMA parking TO parking_svc;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA parking TO parking_svc;
  END IF;
END $$;
