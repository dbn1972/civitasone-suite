-- Purpose: Enable PostGIS extension and add spatial columns + GIST index to location.locations
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS location.idx_locations_geom;
--           ALTER TABLE location.locations DROP COLUMN IF EXISTS geom;
--           ALTER TABLE location.locations DROP CONSTRAINT IF EXISTS locations_lat_check;
--           ALTER TABLE location.locations DROP CONSTRAINT IF EXISTS locations_lng_check;
--           (PostGIS extension should NOT be dropped as other services may depend on it)
-- Affected services: location-service

SET lock_timeout = '5s';

-- ============================================================================
-- 1. Enable PostGIS extension (idempotent)
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS postgis;

-- ============================================================================
-- 2. Alter latitude/longitude columns to DOUBLE PRECISION
--    Migration 0002 added them as numeric(10,7). We alter to double precision
--    for PostGIS compatibility and performance.
-- ============================================================================
ALTER TABLE location.locations
  ALTER COLUMN latitude TYPE DOUBLE PRECISION USING latitude::DOUBLE PRECISION;

ALTER TABLE location.locations
  ALTER COLUMN longitude TYPE DOUBLE PRECISION USING longitude::DOUBLE PRECISION;

-- ============================================================================
-- 3. Add geometry(Point, 4326) column computed from lat/lng
-- ============================================================================
ALTER TABLE location.locations
  ADD COLUMN IF NOT EXISTS geom geometry(Point, 4326);

-- Populate geom for existing rows with valid coordinates
UPDATE location.locations
  SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND geom IS NULL;

-- ============================================================================
-- 4. Create GIST spatial index on geom column (CONCURRENTLY for non-blocking)
-- ============================================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_locations_geom
  ON location.locations USING GIST (geom);

-- ============================================================================
-- 5. Add CHECK constraints for lat/lng ranges
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE location.locations
    ADD CONSTRAINT locations_lat_check
    CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE location.locations
    ADD CONSTRAINT locations_lng_check
    CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Validate constraints (separate pass for safety)
ALTER TABLE location.locations VALIDATE CONSTRAINT locations_lat_check;
ALTER TABLE location.locations VALIDATE CONSTRAINT locations_lng_check;
