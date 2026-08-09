-- building-service initial migration
-- Applied with building_svc role on civitas_building.
-- Generated from src/modules/*/schema.ts — do not invent columns beyond schema.

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS building;

CREATE TABLE IF NOT EXISTS building.building_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  application_number varchar(64) NOT NULL UNIQUE,
  status varchar(32) NOT NULL DEFAULT 'draft',
  site_address jsonb NOT NULL,
  proposed_floors integer,
  architect_name varchar(256),
  architect_licence_no varchar(64),
  structural_engineer varchar(256),
  documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  drawings jsonb NOT NULL DEFAULT '[]'::jsonb,
  fee_minor bigint,
  fee_currency varchar(3) NOT NULL DEFAULT 'INR',
  fee_paid boolean NOT NULL DEFAULT false,
  fee_transaction_id varchar(128),
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  plot_area numeric(12, 2),
  built_up_area numeric(12, 2),
  fsi_requested numeric(6, 3),
  far_computed numeric(6, 3)
);

CREATE TABLE IF NOT EXISTS building.building_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  permit_id uuid NOT NULL,
  cert_type varchar(32) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'issued',
  issued_at timestamptz,
  inspection_report jsonb,
  verification_code varchar(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS building.building_renewals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  permit_id uuid NOT NULL,
  renewal_type varchar(32) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'submitted',
  details jsonb,
  fee_minor bigint,
  fee_currency varchar(3) NOT NULL DEFAULT 'INR',
  previous_valid_until timestamptz,
  new_valid_until timestamptz,
  decided_by uuid,
  decided_at timestamptz,
  decision_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS building.building_permits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  application_id uuid NOT NULL,
  permit_number varchar(64) NOT NULL UNIQUE,
  status varchar(32) NOT NULL DEFAULT 'active',
  issued_at timestamptz,
  valid_until timestamptz,
  conditions jsonb,
  suspended_at timestamptz,
  suspension_reason text,
  cancelled_at timestamptz,
  cancellation_reason text,
  verification_code varchar(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS building.building_scrutiny (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  application_id uuid NOT NULL,
  discipline varchar(32) NOT NULL,
  officer_id uuid NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'pending',
  findings jsonb,
  dcr_results jsonb,
  deficiency_details text,
  completed_at timestamptz,
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

ALTER TABLE building.building_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE building.building_applications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON building.building_applications;
CREATE POLICY tenant_isolation ON building.building_applications
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE building.building_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE building.building_certificates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON building.building_certificates;
CREATE POLICY tenant_isolation ON building.building_certificates
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE building.building_renewals ENABLE ROW LEVEL SECURITY;
ALTER TABLE building.building_renewals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON building.building_renewals;
CREATE POLICY tenant_isolation ON building.building_renewals
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE building.building_permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE building.building_permits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON building.building_permits;
CREATE POLICY tenant_isolation ON building.building_permits
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE building.building_scrutiny ENABLE ROW LEVEL SECURITY;
ALTER TABLE building.building_scrutiny FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON building.building_scrutiny;
CREATE POLICY tenant_isolation ON building.building_scrutiny
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
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'building_svc') THEN
    GRANT USAGE ON SCHEMA _outbox TO building_svc;
    GRANT USAGE ON SCHEMA _inbox TO building_svc;
    GRANT SELECT, INSERT, UPDATE ON _outbox.messages TO building_svc;
    GRANT SELECT, INSERT ON _inbox.processed TO building_svc;
    GRANT USAGE ON SCHEMA building TO building_svc;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA building TO building_svc;
  END IF;
END $$;
