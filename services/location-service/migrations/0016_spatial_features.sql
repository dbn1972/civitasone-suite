-- Migration: 0016_spatial_features.sql
-- Purpose (SVC-117): generic tenant-scoped spatial feature store backing the
--   KML/GeoJSON import + export exchange.
-- Additive, idempotent.
-- Rollback: DROP TABLE location.spatial_features;
SET lock_timeout = '5s';

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS location.spatial_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  dataset varchar(128) NOT NULL,
  name varchar(256),
  feature_type varchar(32) NOT NULL,
  geom geometry(Geometry, 4326) NOT NULL,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  source varchar(16) NOT NULL DEFAULT 'geojson',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_spatial_features_dataset ON location.spatial_features (tenant_id, dataset);
CREATE INDEX IF NOT EXISTS idx_spatial_features_geom ON location.spatial_features USING GIST (geom);

ALTER TABLE location.spatial_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE location.spatial_features FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON location.spatial_features;
CREATE POLICY tenant_isolation_policy ON location.spatial_features
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON location.spatial_features TO location_svc;
