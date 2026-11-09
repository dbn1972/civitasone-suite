-- 0029_locations_geom_trigger_tolerant.sql
--
-- UAT onboarding gap: POST /v1/locations is accepted (202) but the create consumer fails every
-- delivery with `record "new" has no field "geom"`, so no office or location can be created.
--
-- Cause (read-only inspection of UAT civitas_location, 2026-11-09): schema drift. UAT has no
-- PostGIS (pg_available_extensions has no postgis), so 0011 never ran and location.locations
-- has no `geom` column, yet the trigger trg_locations_geom from 0015 exists on it. Its function
-- assigns NEW.geom unconditionally, so EVERY insert / lat-lng update raises. (_applied_migrations
-- on UAT lists neither 0011 nor 0015: the trigger came in by another route than this runner.)
--
-- Fix: the sync function only touches `geom` when the row actually has that column. The check
-- uses to_jsonb(NEW) rather than naming NEW.geom, so the function body is only resolved
-- against `geom` where it exists. Behaviour with PostGIS (0011 applied) is unchanged;
-- without it the trigger becomes a no-op and findNearby keeps its Haversine fallback.
-- Needs no PostGIS itself. Idempotent (CREATE OR REPLACE), additive, no data change.
--
-- Rollback: re-apply the function body from 0015_locations_geom_trigger.sql.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION location.locations_sync_geom() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF to_jsonb(NEW) ? 'geom' THEN
    IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
      NEW.geom := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326);
    ELSE
      NEW.geom := NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;
