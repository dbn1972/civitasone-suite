-- Migration: 0015_locations_geom_trigger.sql
-- Purpose (SVC-118): keep location.locations.geom in sync with latitude/longitude
--   so spatial queries (ST_DWithin / ST_Within / ST_ClusterKMeans) and findNearby
--   return rows created at runtime, not only rows backfilled by 0011.
-- Additive, idempotent.
-- Rollback: DROP TRIGGER trg_locations_geom ON location.locations; DROP FUNCTION location.locations_sync_geom();
SET lock_timeout = '5s';

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE OR REPLACE FUNCTION location.locations_sync_geom() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    NEW.geom := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326);
  ELSE
    NEW.geom := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_locations_geom ON location.locations;
CREATE TRIGGER trg_locations_geom
  BEFORE INSERT OR UPDATE OF latitude, longitude ON location.locations
  FOR EACH ROW EXECUTE FUNCTION location.locations_sync_geom();

-- Backfill any rows that have coordinates but no geom.
UPDATE location.locations
  SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND geom IS NULL;
