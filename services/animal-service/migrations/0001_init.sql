-- animal-service initial migration
-- Applied with animal_svc role on civitas_animal.
-- Generated from src/modules/*/schema.ts — do not invent columns beyond schema.

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS animal;

CREATE TABLE IF NOT EXISTS animal.animal_complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  complaint_number varchar(64) NOT NULL UNIQUE,
  reported_by uuid NOT NULL,
  location jsonb NOT NULL,
  animal_type varchar(32) NOT NULL,
  complaint_type varchar(32) NOT NULL,
  description text,
  photo text,
  severity varchar(16) NOT NULL DEFAULT 'medium',
  status varchar(32) NOT NULL DEFAULT 'reported',
  assigned_to uuid,
  assigned_team varchar(64),
  resolved_at timestamptz,
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS animal.animal_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  complaint_id uuid NOT NULL,
  operation_type varchar(32) NOT NULL,
  performed_by uuid NOT NULL,
  performed_at timestamptz NOT NULL,
  animal_tag_id text,
  location jsonb,
  notes text,
  before_photo text,
  after_photo text,
  shelter_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS animal.animal_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  registration_number varchar(64) NOT NULL UNIQUE,
  owner_name text NOT NULL,
  owner_phone varchar(20) NOT NULL,
  owner_address jsonb NOT NULL,
  animal_type varchar(32) NOT NULL,
  breed varchar(64),
  name text,
  color text,
  age integer,
  sex varchar(8),
  microchip_id text,
  vaccination_records jsonb,
  photo text,
  status varchar(32) NOT NULL DEFAULT 'active',
  valid_until date,
  fee_minor bigint,
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

ALTER TABLE animal.animal_complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE animal.animal_complaints FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON animal.animal_complaints;
CREATE POLICY tenant_isolation ON animal.animal_complaints
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE animal.animal_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE animal.animal_operations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON animal.animal_operations;
CREATE POLICY tenant_isolation ON animal.animal_operations
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE animal.animal_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE animal.animal_registrations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON animal.animal_registrations;
CREATE POLICY tenant_isolation ON animal.animal_registrations
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
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'animal_svc') THEN
    GRANT USAGE ON SCHEMA _outbox TO animal_svc;
    GRANT USAGE ON SCHEMA _inbox TO animal_svc;
    GRANT SELECT, INSERT, UPDATE ON _outbox.messages TO animal_svc;
    GRANT SELECT, INSERT ON _inbox.processed TO animal_svc;
    GRANT USAGE ON SCHEMA animal TO animal_svc;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA animal TO animal_svc;
  END IF;
END $$;
