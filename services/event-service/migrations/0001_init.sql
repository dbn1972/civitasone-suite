-- event-service initial migration
-- Applied with event_svc role on civitas_event.
-- Generated from src/modules/*/schema.ts — do not invent columns beyond schema.

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS event;

CREATE TABLE IF NOT EXISTS event.event_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  application_number varchar(64) NOT NULL UNIQUE,
  status varchar(32) NOT NULL DEFAULT 'draft',
  organiser_name varchar(256) NOT NULL,
  organiser_org varchar(256),
  organiser_phone varchar(15) NOT NULL,
  event_type varchar(32) NOT NULL,
  venue_name varchar(256) NOT NULL,
  venue_address jsonb NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  expected_attendance integer NOT NULL,
  temporary_structures jsonb,
  sound_permission boolean NOT NULL DEFAULT false,
  documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  fee_minor bigint,
  deposit_minor bigint,
  currency varchar(3) NOT NULL DEFAULT 'INR',
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS event.event_noc_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  application_id uuid NOT NULL,
  department varchar(32) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'requested',
  requested_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  conditions jsonb,
  officer_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS event.event_permits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  permit_number varchar(64) NOT NULL UNIQUE,
  application_id uuid NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'issued',
  issued_at timestamptz,
  valid_from timestamptz,
  valid_until timestamptz,
  conditions jsonb,
  verification_code varchar(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS event.event_post_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  permit_id uuid NOT NULL,
  inspector_id uuid NOT NULL,
  inspected_at timestamptz,
  findings jsonb,
  damage_assessment jsonb,
  deposit_decision varchar(32),
  refund_minor bigint,
  currency varchar(3) NOT NULL DEFAULT 'INR',
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

ALTER TABLE event.event_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE event.event_applications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON event.event_applications;
CREATE POLICY tenant_isolation ON event.event_applications
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE event.event_noc_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE event.event_noc_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON event.event_noc_requests;
CREATE POLICY tenant_isolation ON event.event_noc_requests
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE event.event_permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE event.event_permits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON event.event_permits;
CREATE POLICY tenant_isolation ON event.event_permits
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE event.event_post_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE event.event_post_inspections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON event.event_post_inspections;
CREATE POLICY tenant_isolation ON event.event_post_inspections
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
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'event_svc') THEN
    GRANT USAGE ON SCHEMA _outbox TO event_svc;
    GRANT USAGE ON SCHEMA _inbox TO event_svc;
    GRANT SELECT, INSERT, UPDATE ON _outbox.messages TO event_svc;
    GRANT SELECT, INSERT ON _inbox.processed TO event_svc;
    GRANT USAGE ON SCHEMA event TO event_svc;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA event TO event_svc;
  END IF;
END $$;
