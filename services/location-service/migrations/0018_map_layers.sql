-- Migration: 0018_map_layers.sql
-- Purpose (SVC-112): tenant-scoped map layer configuration for the map viewer.
-- Additive, idempotent.
-- Rollback: DROP TABLE location.map_layers;
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS location.map_layers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name varchar(200) NOT NULL,
  source_type varchar(16) NOT NULL CHECK (source_type IN ('tile','wms','geojson')),
  url varchar(2048) NOT NULL,
  style_json jsonb,
  z_index int NOT NULL DEFAULT 0,
  visible boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  version int NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_map_layers_tenant ON location.map_layers (tenant_id, z_index);

ALTER TABLE location.map_layers ENABLE ROW LEVEL SECURITY;
ALTER TABLE location.map_layers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON location.map_layers;
CREATE POLICY tenant_isolation_policy ON location.map_layers
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON location.map_layers TO location_svc;
