-- Purpose: Create parks-service schema and initial tables.
-- Schema: civitas_parks (matches pgSchema("civitas_parks") used by every
-- module in services/parks-service/src/modules/*/schema.ts — NOTE this
-- deviates from the fleet convention of a short schema name matching the
-- service name (see refund/roadcut/shop/trade/vendor, all pgSchema("<svc>")).
-- Flagged for the parks-service deep-dive to decide whether to rename; this
-- migration matches the CODE as it stands today so the app actually works.
-- Tables: parks_complaints, parks_tree_requests, parks_inspections, parks_assets; plus _outbox/_inbox.
-- RLS: FORCE RLS + tenant_id isolation on all domain tables.
-- Rollback: DROP SCHEMA civitas_parks CASCADE;

SET lock_timeout = '5s';

-- ===================== SCHEMAS =====================
CREATE SCHEMA IF NOT EXISTS civitas_parks;
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

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_parks_outbox_unpublished
  ON _outbox.messages (created_at)
  WHERE published_at IS NULL;

-- ===================== civitas_parks.parks_complaints =====================
CREATE TABLE IF NOT EXISTS civitas_parks.parks_complaints (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  complaint_number  varchar(32) NOT NULL,
  reported_by       uuid NOT NULL,
  location          jsonb,
  park_asset_ref    text,
  complaint_type    varchar(32) NOT NULL,
  description       text,
  photo             text,
  severity          varchar(16),
  status            varchar(24) NOT NULL DEFAULT 'reported',
  assigned_to       uuid,
  resolution        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  updated_by        uuid NOT NULL,
  version           integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS parks_complaints_tenant_idx ON civitas_parks.parks_complaints (tenant_id);
CREATE INDEX IF NOT EXISTS parks_complaints_status_idx ON civitas_parks.parks_complaints (tenant_id, status);

ALTER TABLE civitas_parks.parks_complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE civitas_parks.parks_complaints FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'parks_complaints' AND schemaname = 'civitas_parks' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON civitas_parks.parks_complaints
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== civitas_parks.parks_tree_requests =====================
CREATE TABLE IF NOT EXISTS civitas_parks.parks_tree_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  request_number      varchar(32) NOT NULL,
  requested_by        uuid NOT NULL,
  request_type        varchar(24) NOT NULL,
  location            jsonb,
  tree_species        text,
  reason              text,
  photos              jsonb,
  status              varchar(24) NOT NULL DEFAULT 'submitted',
  inspector_id        uuid,
  inspection_report   jsonb,
  approved_by         uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL,
  updated_by          uuid NOT NULL,
  version             integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS parks_tree_requests_tenant_idx ON civitas_parks.parks_tree_requests (tenant_id);
CREATE INDEX IF NOT EXISTS parks_tree_requests_status_idx ON civitas_parks.parks_tree_requests (tenant_id, status);

ALTER TABLE civitas_parks.parks_tree_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE civitas_parks.parks_tree_requests FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'parks_tree_requests' AND schemaname = 'civitas_parks' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON civitas_parks.parks_tree_requests
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== civitas_parks.parks_inspections =====================
CREATE TABLE IF NOT EXISTS civitas_parks.parks_inspections (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  complaint_id          uuid,
  tree_request_id       uuid,
  inspector_id          uuid NOT NULL,
  scheduled_date        date,
  inspected_at          timestamptz,
  findings              jsonb,
  photos                jsonb,
  work_order_required   boolean NOT NULL DEFAULT false,
  status                varchar(24) NOT NULL DEFAULT 'scheduled',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL,
  updated_by            uuid NOT NULL,
  version               integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS parks_inspections_tenant_idx ON civitas_parks.parks_inspections (tenant_id);
CREATE INDEX IF NOT EXISTS parks_inspections_status_idx ON civitas_parks.parks_inspections (tenant_id, status);

ALTER TABLE civitas_parks.parks_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE civitas_parks.parks_inspections FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'parks_inspections' AND schemaname = 'civitas_parks' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON civitas_parks.parks_inspections
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== civitas_parks.parks_assets =====================
CREATE TABLE IF NOT EXISTS civitas_parks.parks_assets (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  asset_code            varchar(32) NOT NULL,
  asset_type            varchar(24) NOT NULL,
  name                  text,
  location              jsonb,
  area                  text,
  area_unit             varchar(16),
  status                varchar(24) NOT NULL DEFAULT 'active',
  last_maintenance_date date,
  maintenance_history   jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL,
  updated_by            uuid NOT NULL,
  version               integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS parks_assets_tenant_idx ON civitas_parks.parks_assets (tenant_id);
CREATE INDEX IF NOT EXISTS parks_assets_status_idx ON civitas_parks.parks_assets (tenant_id, status);

ALTER TABLE civitas_parks.parks_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE civitas_parks.parks_assets FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'parks_assets' AND schemaname = 'civitas_parks' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON civitas_parks.parks_assets
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;
