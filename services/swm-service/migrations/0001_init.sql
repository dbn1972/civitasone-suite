-- swm-service initial migration
-- Applied with swm_svc role on civitas_swm.
-- Generated from src/modules/*/schema.ts — do not invent columns beyond schema.

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS civitas_swm;

CREATE TABLE IF NOT EXISTS civitas_swm.swm_hotspots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  hotspot_code varchar(32) NOT NULL,
  location jsonb,
  category varchar(32),
  complaint_count integer NOT NULL DEFAULT 0,
  risk_score integer NOT NULL DEFAULT 0,
  status varchar(24) NOT NULL DEFAULT 'identified',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS civitas_swm.swm_bulk_generators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  registration_number varchar(32) NOT NULL,
  generator_name varchar(128) NOT NULL,
  generator_type varchar(32) NOT NULL,
  address jsonb,
  estimated_waste_kg_per_day integer,
  category varchar(16) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'registered',
  fee_minor integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS civitas_swm.swm_collection_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  request_number varchar(32) NOT NULL,
  requested_by uuid NOT NULL,
  waste_type varchar(32) NOT NULL,
  estimated_quantity text,
  address jsonb,
  preferred_date date,
  preferred_slot varchar(24),
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

CREATE TABLE IF NOT EXISTS civitas_swm.swm_field_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  task_number varchar(32) NOT NULL,
  route_id text,
  zone_id text,
  assigned_to uuid,
  task_date date,
  asset_refs jsonb,
  status varchar(24) NOT NULL DEFAULT 'assigned',
  completed_at timestamptz,
  notes text,
  photos jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS civitas_swm.swm_complaints (
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

ALTER TABLE civitas_swm.swm_hotspots ENABLE ROW LEVEL SECURITY;
ALTER TABLE civitas_swm.swm_hotspots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON civitas_swm.swm_hotspots;
CREATE POLICY tenant_isolation ON civitas_swm.swm_hotspots
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE civitas_swm.swm_bulk_generators ENABLE ROW LEVEL SECURITY;
ALTER TABLE civitas_swm.swm_bulk_generators FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON civitas_swm.swm_bulk_generators;
CREATE POLICY tenant_isolation ON civitas_swm.swm_bulk_generators
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE civitas_swm.swm_collection_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE civitas_swm.swm_collection_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON civitas_swm.swm_collection_requests;
CREATE POLICY tenant_isolation ON civitas_swm.swm_collection_requests
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE civitas_swm.swm_field_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE civitas_swm.swm_field_tasks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON civitas_swm.swm_field_tasks;
CREATE POLICY tenant_isolation ON civitas_swm.swm_field_tasks
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE civitas_swm.swm_complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE civitas_swm.swm_complaints FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON civitas_swm.swm_complaints;
CREATE POLICY tenant_isolation ON civitas_swm.swm_complaints
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
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'swm_svc') THEN
    GRANT USAGE ON SCHEMA _outbox TO swm_svc;
    GRANT USAGE ON SCHEMA _inbox TO swm_svc;
    GRANT SELECT, INSERT, UPDATE ON _outbox.messages TO swm_svc;
    GRANT SELECT, INSERT ON _inbox.processed TO swm_svc;
    GRANT USAGE ON SCHEMA civitas_swm TO swm_svc;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA civitas_swm TO swm_svc;
  END IF;
END $$;
