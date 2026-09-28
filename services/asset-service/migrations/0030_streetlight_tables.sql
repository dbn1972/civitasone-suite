-- Migration: 0030_streetlight_tables.sql
-- Purpose: facade-closure for asset-service's streetlight module.
--   streetlight/routes.ts publishes commands (asset.streetlight.create,
--   asset.streetlight.status.update, asset.streetlight.fault.*,
--   asset.streetlight.request.*) but no consumer.ts was ever registered in
--   worker.ts, and no migration ever created a `streetlight` schema or any
--   table in it (confirmed by grepping every migration file) -- so POST
--   returns 202 {id,status:"accepted"} but nothing is ever persisted, and
--   GET list/by-id either 500s ("relation ... does not exist") or comes
--   back silently empty.
-- This migration creates the `streetlight` schema and its three tables
-- exactly matching the pre-existing src/modules/streetlight/schema.ts
-- Drizzle definitions (already written, just never migrated), plus RLS
-- (FORCE + tenant_isolation_policy via register.current_tenant_id(), the
-- shared cross-schema GUC accessor -- see 0007/0009/0016/0018) and the
-- standard audit columns (created_by/updated_by/created_at/updated_at/version).
-- Affected service: asset-service
-- Rollback: DROP TABLE IF EXISTS streetlight.asset_streetlight_requests;
--           DROP TABLE IF EXISTS streetlight.asset_streetlight_faults;
--           DROP TABLE IF EXISTS streetlight.asset_streetlights;
--           DROP SCHEMA IF EXISTS streetlight;

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS streetlight;

-- ── asset_streetlights ──────────────────────────────────────────────────────
-- NOTE: pole_id is globally UNIQUE (not per-tenant) -- mirrors schema.ts's
-- `.unique()` (a single-column constraint, not a composite one) exactly as
-- already written. Flagging this as worth a second look separately:
-- register.asset_assets uses a composite UNIQUE(tenant_id, code) for the
-- equivalent case, so two tenants both wanting pole "SL-001" would collide
-- here. Not changed in this migration -- it mirrors the pre-existing
-- Drizzle schema faithfully rather than redesigning it.

CREATE TABLE IF NOT EXISTS streetlight.asset_streetlights (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL,
  pole_id               text        NOT NULL UNIQUE,
  location              jsonb,
  lamp_type             varchar(16) NOT NULL,
  wattage               integer     NOT NULL,
  installation_date     date,
  status                varchar(24) NOT NULL DEFAULT 'operational',
  last_maintenance_date date,
  circuit_id            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid        NOT NULL,
  updated_by            uuid        NOT NULL,
  version               integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_streetlights_tenant ON streetlight.asset_streetlights (tenant_id);

-- ── asset_streetlight_faults ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS streetlight.asset_streetlight_faults (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  streetlight_id uuid        NOT NULL REFERENCES streetlight.asset_streetlights(id),
  fault_number   text        NOT NULL,
  reported_by    uuid        NOT NULL,
  reported_at    timestamptz NOT NULL DEFAULT now(),
  fault_type     varchar(24) NOT NULL,
  description    text,
  photo          text,
  status         varchar(16) NOT NULL DEFAULT 'reported',
  assigned_to    uuid,
  resolved_at    timestamptz,
  resolution     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_by     uuid        NOT NULL,
  version        integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_streetlight_faults_tenant      ON streetlight.asset_streetlight_faults (tenant_id);
CREATE INDEX IF NOT EXISTS idx_streetlight_faults_streetlight ON streetlight.asset_streetlight_faults (streetlight_id);

-- ── asset_streetlight_requests ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS streetlight.asset_streetlight_requests (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  request_number text        NOT NULL,
  requested_by   uuid        NOT NULL,
  request_type   varchar(16) NOT NULL,
  location       jsonb,
  justification  text,
  status         varchar(16) NOT NULL DEFAULT 'submitted',
  survey_report  jsonb,
  approved_by    uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_by     uuid        NOT NULL,
  version        integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_streetlight_requests_tenant ON streetlight.asset_streetlight_requests (tenant_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- register.current_tenant_id() is the shared cross-schema GUC accessor used by
-- every other asset-service module (see 0007/0009/0016/0018).

ALTER TABLE streetlight.asset_streetlights ENABLE ROW LEVEL SECURITY;
ALTER TABLE streetlight.asset_streetlights FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON streetlight.asset_streetlights;
CREATE POLICY tenant_isolation_policy ON streetlight.asset_streetlights
  FOR ALL
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());

ALTER TABLE streetlight.asset_streetlight_faults ENABLE ROW LEVEL SECURITY;
ALTER TABLE streetlight.asset_streetlight_faults FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON streetlight.asset_streetlight_faults;
CREATE POLICY tenant_isolation_policy ON streetlight.asset_streetlight_faults
  FOR ALL
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());

ALTER TABLE streetlight.asset_streetlight_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE streetlight.asset_streetlight_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON streetlight.asset_streetlight_requests;
CREATE POLICY tenant_isolation_policy ON streetlight.asset_streetlight_requests
  FOR ALL
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());
