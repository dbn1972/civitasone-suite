-- fire-service initial migration
-- Applied with fire_svc role on civitas_fire.
-- Generated from src/modules/*/schema.ts — do not invent columns beyond schema.

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS fire_applications;

CREATE TABLE IF NOT EXISTS fire_applications.fire_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  application_number varchar(64) NOT NULL UNIQUE,
  status varchar(32) NOT NULL DEFAULT 'draft',
  building_name text NOT NULL,
  building_address jsonb NOT NULL,
  occupancy_type varchar(32) NOT NULL,
  building_height text,
  number_of_floors integer,
  built_up_area text,
  fire_safety_measures jsonb,
  documents jsonb,
  fee_minor bigint,
  fee_currency char(3) NOT NULL DEFAULT 'INR',
  fee_paid boolean NOT NULL DEFAULT false,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE SCHEMA IF NOT EXISTS fire_inspections;

CREATE TABLE IF NOT EXISTS fire_inspections.fire_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  application_id uuid NOT NULL,
  inspector_id uuid NOT NULL,
  scheduled_date date NOT NULL,
  inspected_at timestamptz,
  findings jsonb,
  deficiencies jsonb,
  status varchar(32) NOT NULL DEFAULT 'scheduled',
  recommendation varchar(32),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE SCHEMA IF NOT EXISTS fire_lifecycle;

CREATE TABLE IF NOT EXISTS fire_lifecycle.fire_renewals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  noc_id uuid NOT NULL,
  renewal_type varchar(32) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'requested',
  fee_minor bigint,
  previous_valid_until date,
  new_valid_until date,
  decision varchar(32),
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE SCHEMA IF NOT EXISTS fire_nocs;

CREATE TABLE IF NOT EXISTS fire_nocs.fire_nocs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  noc_number varchar(64) NOT NULL UNIQUE,
  application_id uuid NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'issued',
  issued_at timestamptz,
  valid_from date,
  valid_until date,
  conditions jsonb,
  verification_code varchar(32),
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

ALTER TABLE fire_applications.fire_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE fire_applications.fire_applications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON fire_applications.fire_applications;
CREATE POLICY tenant_isolation ON fire_applications.fire_applications
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE fire_inspections.fire_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE fire_inspections.fire_inspections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON fire_inspections.fire_inspections;
CREATE POLICY tenant_isolation ON fire_inspections.fire_inspections
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE fire_lifecycle.fire_renewals ENABLE ROW LEVEL SECURITY;
ALTER TABLE fire_lifecycle.fire_renewals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON fire_lifecycle.fire_renewals;
CREATE POLICY tenant_isolation ON fire_lifecycle.fire_renewals
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE fire_nocs.fire_nocs ENABLE ROW LEVEL SECURITY;
ALTER TABLE fire_nocs.fire_nocs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON fire_nocs.fire_nocs;
CREATE POLICY tenant_isolation ON fire_nocs.fire_nocs
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
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fire_svc') THEN
    GRANT USAGE ON SCHEMA _outbox TO fire_svc;
    GRANT USAGE ON SCHEMA _inbox TO fire_svc;
    GRANT SELECT, INSERT, UPDATE ON _outbox.messages TO fire_svc;
    GRANT SELECT, INSERT ON _inbox.processed TO fire_svc;
    GRANT USAGE ON SCHEMA fire_applications TO fire_svc;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA fire_applications TO fire_svc;
    GRANT USAGE ON SCHEMA fire_inspections TO fire_svc;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA fire_inspections TO fire_svc;
    GRANT USAGE ON SCHEMA fire_lifecycle TO fire_svc;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA fire_lifecycle TO fire_svc;
    GRANT USAGE ON SCHEMA fire_nocs TO fire_svc;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA fire_nocs TO fire_svc;
  END IF;
END $$;
