-- Migration: 0017_road_network.sql
-- Purpose (SVC-115): persisted road/route network — road_segments (PostGIS
--   LineString) + route_networks, tenant-isolated.
-- Additive, idempotent.
-- Rollback: DROP TABLE location.route_networks; DROP TABLE location.road_segments;
SET lock_timeout = '5s';

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS location.road_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name varchar(200) NOT NULL,
  road_class varchar(32) NOT NULL CHECK (road_class IN ('national_highway','state_highway','major_district_road','other_district_road','village_road','urban_road')),
  from_node varchar(64) NOT NULL,
  to_node varchar(64) NOT NULL,
  geom geometry(LineString, 4326) NOT NULL,
  length_meters numeric(12,2) NOT NULL DEFAULT 0,
  status varchar(16) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  version int NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_road_segments_tenant ON location.road_segments (tenant_id);
CREATE INDEX IF NOT EXISTS idx_road_segments_nodes ON location.road_segments (tenant_id, from_node, to_node);
CREATE INDEX IF NOT EXISTS idx_road_segments_geom ON location.road_segments USING GIST (geom);

CREATE TABLE IF NOT EXISTS location.route_networks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name varchar(200) NOT NULL,
  description varchar(1000),
  segment_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  status varchar(16) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  version int NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_route_networks_tenant ON location.route_networks (tenant_id);

DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['road_segments','route_networks'] LOOP
    EXECUTE format('ALTER TABLE location.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE location.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON location.%I', t);
    EXECUTE format('CREATE POLICY tenant_isolation_policy ON location.%I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t);
  END LOOP;
END $rls$;

GRANT SELECT, INSERT, UPDATE, DELETE ON location.road_segments, location.route_networks TO location_svc;
