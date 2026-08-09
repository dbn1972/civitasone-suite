-- roadcut-service initial migration
-- Applied with roadcut_svc role on civitas_roadcut.
-- Generated from src/modules/*/schema.ts — do not invent columns beyond schema.

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS roadcut;

CREATE TABLE IF NOT EXISTS roadcut.roadcut_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  application_number varchar(64) NOT NULL UNIQUE,
  status varchar(32) NOT NULL DEFAULT 'draft',
  applicant_name varchar(256) NOT NULL,
  applicant_org varchar(256),
  purpose varchar(64) NOT NULL,
  location jsonb NOT NULL,
  road_type varchar(32) NOT NULL,
  cutting_length text NOT NULL,
  cutting_width text NOT NULL,
  cutting_depth text NOT NULL,
  documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  fee_minor bigint,
  deposit_minor bigint,
  currency char(3) NOT NULL DEFAULT 'INR',
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS roadcut.roadcut_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  permit_id uuid NOT NULL,
  inspection_type varchar(32) NOT NULL,
  inspector_id uuid NOT NULL,
  scheduled_date date NOT NULL,
  inspected_at timestamptz,
  findings jsonb,
  photos jsonb,
  status varchar(32) NOT NULL DEFAULT 'scheduled',
  restoration_quality varchar(32),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS roadcut.roadcut_permits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  permit_number varchar(64) NOT NULL UNIQUE,
  application_id uuid NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'issued',
  issued_at timestamptz,
  work_start_date date NOT NULL,
  work_end_date date NOT NULL,
  extended_until date,
  conditions jsonb,
  verification_code varchar(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS roadcut.roadcut_restorations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  permit_id uuid NOT NULL,
  restoration_start_date date,
  restoration_end_date date,
  quality varchar(32) NOT NULL DEFAULT 'pending',
  deposit_refund_status varchar(32) NOT NULL DEFAULT 'held',
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

ALTER TABLE roadcut.roadcut_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE roadcut.roadcut_applications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON roadcut.roadcut_applications;
CREATE POLICY tenant_isolation ON roadcut.roadcut_applications
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE roadcut.roadcut_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE roadcut.roadcut_inspections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON roadcut.roadcut_inspections;
CREATE POLICY tenant_isolation ON roadcut.roadcut_inspections
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE roadcut.roadcut_permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE roadcut.roadcut_permits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON roadcut.roadcut_permits;
CREATE POLICY tenant_isolation ON roadcut.roadcut_permits
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE roadcut.roadcut_restorations ENABLE ROW LEVEL SECURITY;
ALTER TABLE roadcut.roadcut_restorations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON roadcut.roadcut_restorations;
CREATE POLICY tenant_isolation ON roadcut.roadcut_restorations
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
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'roadcut_svc') THEN
    GRANT USAGE ON SCHEMA _outbox TO roadcut_svc;
    GRANT USAGE ON SCHEMA _inbox TO roadcut_svc;
    GRANT SELECT, INSERT, UPDATE ON _outbox.messages TO roadcut_svc;
    GRANT SELECT, INSERT ON _inbox.processed TO roadcut_svc;
    GRANT USAGE ON SCHEMA roadcut TO roadcut_svc;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA roadcut TO roadcut_svc;
  END IF;
END $$;
