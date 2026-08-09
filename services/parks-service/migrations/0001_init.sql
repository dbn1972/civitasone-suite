-- parks-service initial migration
-- Applied with parks_svc role on civitas_parks.
-- Generated from src/modules/*/schema.ts — do not invent columns beyond schema.

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS civitas_parks;

CREATE TABLE IF NOT EXISTS civitas_parks.parks_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  asset_code varchar(32) NOT NULL,
  asset_type varchar(24) NOT NULL,
  name text,
  location jsonb,
  area text,
  area_unit varchar(16),
  status varchar(24) NOT NULL DEFAULT 'active',
  last_maintenance_date date,
  maintenance_history jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS civitas_parks.parks_complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  complaint_number varchar(32) NOT NULL,
  reported_by uuid NOT NULL,
  location jsonb,
  park_asset_ref text,
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

CREATE TABLE IF NOT EXISTS civitas_parks.parks_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  complaint_id uuid,
  tree_request_id uuid,
  inspector_id uuid NOT NULL,
  scheduled_date date,
  inspected_at timestamptz,
  findings jsonb,
  photos jsonb,
  work_order_required boolean NOT NULL DEFAULT false,
  status varchar(24) NOT NULL DEFAULT 'scheduled',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS civitas_parks.parks_tree_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  request_number varchar(32) NOT NULL,
  requested_by uuid NOT NULL,
  request_type varchar(24) NOT NULL,
  location jsonb,
  tree_species text,
  reason text,
  photos jsonb,
  status varchar(24) NOT NULL DEFAULT 'submitted',
  inspector_id uuid,
  inspection_report jsonb,
  approved_by uuid,
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

ALTER TABLE civitas_parks.parks_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE civitas_parks.parks_assets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON civitas_parks.parks_assets;
CREATE POLICY tenant_isolation ON civitas_parks.parks_assets
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE civitas_parks.parks_complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE civitas_parks.parks_complaints FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON civitas_parks.parks_complaints;
CREATE POLICY tenant_isolation ON civitas_parks.parks_complaints
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE civitas_parks.parks_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE civitas_parks.parks_inspections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON civitas_parks.parks_inspections;
CREATE POLICY tenant_isolation ON civitas_parks.parks_inspections
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE civitas_parks.parks_tree_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE civitas_parks.parks_tree_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON civitas_parks.parks_tree_requests;
CREATE POLICY tenant_isolation ON civitas_parks.parks_tree_requests
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
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'parks_svc') THEN
    GRANT USAGE ON SCHEMA _outbox TO parks_svc;
    GRANT USAGE ON SCHEMA _inbox TO parks_svc;
    GRANT SELECT, INSERT, UPDATE ON _outbox.messages TO parks_svc;
    GRANT SELECT, INSERT ON _inbox.processed TO parks_svc;
    GRANT USAGE ON SCHEMA civitas_parks TO parks_svc;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA civitas_parks TO parks_svc;
  END IF;
END $$;
