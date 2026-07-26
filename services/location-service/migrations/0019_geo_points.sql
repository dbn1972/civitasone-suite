-- Migration: 0019_geo_points.sql
-- Purpose (SVC-119): generic tenant-scoped geo-point registry that other
--   services publish into, feeding the map-markers monitoring feed.
-- Additive, idempotent.
-- Rollback: DROP TABLE location.geo_points;
SET lock_timeout = '5s';

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS location.geo_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  domain varchar(48) NOT NULL,
  ref_id varchar(128) NOT NULL,
  lat numeric(10,7) NOT NULL,
  lng numeric(10,7) NOT NULL,
  label varchar(256),
  status varchar(32) NOT NULL DEFAULT 'active',
  geom geometry(Point, 4326),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  CONSTRAINT uq_geo_points UNIQUE (tenant_id, domain, ref_id)
);
CREATE INDEX IF NOT EXISTS idx_geo_points_tenant ON location.geo_points (tenant_id, domain, status);
CREATE INDEX IF NOT EXISTS idx_geo_points_geom ON location.geo_points USING GIST (geom);

CREATE OR REPLACE FUNCTION location.geo_points_sync_geom() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.geom := ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_geo_points_geom ON location.geo_points;
CREATE TRIGGER trg_geo_points_geom
  BEFORE INSERT OR UPDATE OF lat, lng ON location.geo_points
  FOR EACH ROW EXECUTE FUNCTION location.geo_points_sync_geom();

ALTER TABLE location.geo_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE location.geo_points FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON location.geo_points;
CREATE POLICY tenant_isolation_policy ON location.geo_points
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON location.geo_points TO location_svc;
