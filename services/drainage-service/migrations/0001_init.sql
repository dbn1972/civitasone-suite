-- drainage-service initial migration
-- Applied with drainage_svc role on civitas_drainage.
-- Generated from src/modules/*/schema.ts — do not invent columns beyond schema.

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS civitas_drainage;

CREATE TABLE IF NOT EXISTS civitas_drainage.drainage_complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  complaint_number varchar(32) NOT NULL,
  reported_by uuid NOT NULL,
  location jsonb,
  complaint_type varchar(32) NOT NULL,
  description text,
  photo text,
  severity varchar(16) NOT NULL DEFAULT 'medium',
  status varchar(24) NOT NULL DEFAULT 'reported',
  assigned_to uuid,
  assigned_at timestamptz,
  resolved_at timestamptz,
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS civitas_drainage.drainage_field_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  complaint_id uuid NOT NULL,
  action_type varchar(32) NOT NULL,
  performed_by uuid NOT NULL,
  performed_at timestamptz NOT NULL DEFAULT now(),
  drain_asset_ref text,
  notes text,
  before_photo text,
  after_photo text,
  duration_minutes integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS civitas_drainage.drainage_hotspots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  hotspot_code varchar(32) NOT NULL,
  location jsonb,
  category varchar(32),
  complaint_count integer NOT NULL DEFAULT 0,
  last_complaint_at timestamptz,
  risk_score integer NOT NULL DEFAULT 0,
  status varchar(32) NOT NULL DEFAULT 'identified',
  maintenance_plan_ref text,
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

ALTER TABLE civitas_drainage.drainage_complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE civitas_drainage.drainage_complaints FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON civitas_drainage.drainage_complaints;
CREATE POLICY tenant_isolation ON civitas_drainage.drainage_complaints
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE civitas_drainage.drainage_field_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE civitas_drainage.drainage_field_actions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON civitas_drainage.drainage_field_actions;
CREATE POLICY tenant_isolation ON civitas_drainage.drainage_field_actions
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE civitas_drainage.drainage_hotspots ENABLE ROW LEVEL SECURITY;
ALTER TABLE civitas_drainage.drainage_hotspots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON civitas_drainage.drainage_hotspots;
CREATE POLICY tenant_isolation ON civitas_drainage.drainage_hotspots
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
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'drainage_svc') THEN
    GRANT USAGE ON SCHEMA _outbox TO drainage_svc;
    GRANT USAGE ON SCHEMA _inbox TO drainage_svc;
    GRANT SELECT, INSERT, UPDATE ON _outbox.messages TO drainage_svc;
    GRANT SELECT, INSERT ON _inbox.processed TO drainage_svc;
    GRANT USAGE ON SCHEMA civitas_drainage TO drainage_svc;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA civitas_drainage TO drainage_svc;
  END IF;
END $$;
