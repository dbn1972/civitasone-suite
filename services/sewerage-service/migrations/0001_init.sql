-- sewerage-service initial migration
-- Applied with sewerage_svc role on civitas_sewerage.
-- Generated from src/modules/*/schema.ts — do not invent columns beyond schema.

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS civitas_sewerage;

CREATE TABLE IF NOT EXISTS civitas_sewerage.sewerage_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  bill_number varchar(32) NOT NULL,
  billing_period varchar(24) NOT NULL,
  amount_minor integer NOT NULL,
  due_date date NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'generated',
  payment_ref varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS civitas_sewerage.sewerage_complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  complaint_number varchar(32) NOT NULL,
  reported_by uuid NOT NULL,
  location jsonb,
  complaint_type varchar(32) NOT NULL,
  description text,
  photo text,
  severity varchar(16),
  status varchar(24) NOT NULL DEFAULT 'reported',
  assigned_to uuid,
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS civitas_sewerage.sewerage_field_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  complaint_id uuid,
  booking_id uuid,
  asset_ref text,
  manhole_ref text,
  work_performed text,
  before_photo text,
  after_photo text,
  closed_by uuid,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS civitas_sewerage.sewerage_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  application_number varchar(32) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'submitted',
  property_ref text,
  water_connection_ref text,
  connection_class varchar(24) NOT NULL,
  site_details jsonb,
  fee_minor integer,
  fee_paid boolean NOT NULL DEFAULT false,
  feasibility_report jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS civitas_sewerage.sewerage_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  connection_number varchar(32) NOT NULL,
  application_id uuid NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'active',
  activation_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS civitas_sewerage.sewerage_desludging_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  booking_number varchar(32) NOT NULL,
  requested_by uuid NOT NULL,
  address jsonb,
  tank_capacity_litres integer,
  requested_date date,
  requested_slot varchar(24),
  status varchar(24) NOT NULL DEFAULT 'requested',
  vehicle_id text,
  fee_minor integer,
  fee_paid boolean NOT NULL DEFAULT false,
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

ALTER TABLE civitas_sewerage.sewerage_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE civitas_sewerage.sewerage_bills FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON civitas_sewerage.sewerage_bills;
CREATE POLICY tenant_isolation ON civitas_sewerage.sewerage_bills
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE civitas_sewerage.sewerage_complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE civitas_sewerage.sewerage_complaints FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON civitas_sewerage.sewerage_complaints;
CREATE POLICY tenant_isolation ON civitas_sewerage.sewerage_complaints
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE civitas_sewerage.sewerage_field_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE civitas_sewerage.sewerage_field_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON civitas_sewerage.sewerage_field_records;
CREATE POLICY tenant_isolation ON civitas_sewerage.sewerage_field_records
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE civitas_sewerage.sewerage_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE civitas_sewerage.sewerage_applications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON civitas_sewerage.sewerage_applications;
CREATE POLICY tenant_isolation ON civitas_sewerage.sewerage_applications
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE civitas_sewerage.sewerage_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE civitas_sewerage.sewerage_connections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON civitas_sewerage.sewerage_connections;
CREATE POLICY tenant_isolation ON civitas_sewerage.sewerage_connections
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE civitas_sewerage.sewerage_desludging_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE civitas_sewerage.sewerage_desludging_bookings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON civitas_sewerage.sewerage_desludging_bookings;
CREATE POLICY tenant_isolation ON civitas_sewerage.sewerage_desludging_bookings
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
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sewerage_svc') THEN
    GRANT USAGE ON SCHEMA _outbox TO sewerage_svc;
    GRANT USAGE ON SCHEMA _inbox TO sewerage_svc;
    GRANT SELECT, INSERT, UPDATE ON _outbox.messages TO sewerage_svc;
    GRANT SELECT, INSERT ON _inbox.processed TO sewerage_svc;
    GRANT USAGE ON SCHEMA civitas_sewerage TO sewerage_svc;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA civitas_sewerage TO sewerage_svc;
  END IF;
END $$;
