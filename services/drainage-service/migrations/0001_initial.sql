-- Purpose: Create drainage-service schema and initial tables.
-- Schema: civitas_drainage
--   NOTE (deep-verify, not changed): every sibling service in this migration
--   pattern uses a schema name matching its service name 1:1 (animal, market,
--   parking, ...). drainage-service's own src/modules/*/schema.ts already
--   hardcodes pgSchema("civitas_drainage") — an inconsistent name — across all
--   three of its modules. Matching that existing (inconsistent) literal here
--   rather than "fixing" it to `drainage`, since renaming the schema would
--   require a coordinated change across every schema.ts file plus this
--   migration in the same PR, which is a larger and riskier change than this
--   deep-verification pass warrants. Flagged in the PR description.
-- Tables: drainage_complaints, drainage_field_actions, drainage_hotspots; plus _outbox/_inbox.
-- RLS: FORCE RLS + tenant_id isolation on all domain tables.
-- Rollback: DROP SCHEMA civitas_drainage CASCADE;

SET lock_timeout = '5s';

-- ===================== SCHEMAS =====================
CREATE SCHEMA IF NOT EXISTS civitas_drainage;
CREATE SCHEMA IF NOT EXISTS _outbox;
CREATE SCHEMA IF NOT EXISTS _inbox;

-- ===================== OUTBOX / INBOX =====================
CREATE TABLE IF NOT EXISTS _outbox.messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic           varchar(128) NOT NULL,
  event_type      varchar(128) NOT NULL,
  tenant_id       uuid NOT NULL,
  actor_id        uuid NOT NULL,
  correlation_id  varchar(64) NOT NULL,
  payload         jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  published_at    timestamptz
);

CREATE TABLE IF NOT EXISTS _inbox.processed (
  message_id   uuid PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_drainage_outbox_unpublished
  ON _outbox.messages (created_at)
  WHERE published_at IS NULL;

-- ===================== civitas_drainage.drainage_complaints =====================
CREATE TABLE IF NOT EXISTS civitas_drainage.drainage_complaints (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  -- UNIQUE added in this pass (see complaints/schema.ts comment): safe now
  -- since this table has no existing rows.
  complaint_number  varchar(32) NOT NULL UNIQUE,
  reported_by       uuid NOT NULL,
  location          jsonb,
  complaint_type    varchar(32) NOT NULL,
  description       text,
  photo             text,
  severity          varchar(16) NOT NULL DEFAULT 'medium',
  status            varchar(24) NOT NULL DEFAULT 'reported',
  assigned_to       uuid,
  assigned_at       timestamptz,
  resolved_at       timestamptz,
  resolution        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  updated_by        uuid NOT NULL,
  version           integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS drainage_complaints_tenant_idx ON civitas_drainage.drainage_complaints (tenant_id);
CREATE INDEX IF NOT EXISTS drainage_complaints_status_idx ON civitas_drainage.drainage_complaints (tenant_id, status);
CREATE INDEX IF NOT EXISTS drainage_complaints_assigned_idx ON civitas_drainage.drainage_complaints (tenant_id, assigned_to);

ALTER TABLE civitas_drainage.drainage_complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE civitas_drainage.drainage_complaints FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'drainage_complaints' AND schemaname = 'civitas_drainage' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON civitas_drainage.drainage_complaints
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== civitas_drainage.drainage_field_actions =====================
CREATE TABLE IF NOT EXISTS civitas_drainage.drainage_field_actions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  complaint_id      uuid NOT NULL,
  action_type       varchar(32) NOT NULL,
  performed_by      uuid NOT NULL,
  performed_at      timestamptz NOT NULL DEFAULT now(),
  drain_asset_ref   text,
  notes             text,
  before_photo      text,
  after_photo       text,
  duration_minutes  integer,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  updated_by        uuid NOT NULL,
  version           integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS drainage_field_actions_tenant_idx     ON civitas_drainage.drainage_field_actions (tenant_id);
CREATE INDEX IF NOT EXISTS drainage_field_actions_complaint_idx  ON civitas_drainage.drainage_field_actions (tenant_id, complaint_id);

ALTER TABLE civitas_drainage.drainage_field_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE civitas_drainage.drainage_field_actions FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'drainage_field_actions' AND schemaname = 'civitas_drainage' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON civitas_drainage.drainage_field_actions
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== civitas_drainage.drainage_hotspots =====================
CREATE TABLE IF NOT EXISTS civitas_drainage.drainage_hotspots (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  -- UNIQUE added in this pass, same reasoning as drainage_complaints.complaint_number.
  hotspot_code          varchar(32) NOT NULL UNIQUE,
  location              jsonb,
  category              varchar(32),
  complaint_count       integer NOT NULL DEFAULT 0,
  last_complaint_at     timestamptz,
  risk_score            integer NOT NULL DEFAULT 0,
  status                varchar(32) NOT NULL DEFAULT 'identified',
  maintenance_plan_ref  text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL,
  updated_by            uuid NOT NULL,
  version               integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS drainage_hotspots_tenant_idx ON civitas_drainage.drainage_hotspots (tenant_id);
CREATE INDEX IF NOT EXISTS drainage_hotspots_status_idx ON civitas_drainage.drainage_hotspots (tenant_id, status);

ALTER TABLE civitas_drainage.drainage_hotspots ENABLE ROW LEVEL SECURITY;
ALTER TABLE civitas_drainage.drainage_hotspots FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'drainage_hotspots' AND schemaname = 'civitas_drainage' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON civitas_drainage.drainage_hotspots
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;
