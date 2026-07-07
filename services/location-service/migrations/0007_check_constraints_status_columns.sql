-- Purpose: Add CHECK constraints on all status/type columns to restrict values to defined state machine states
-- Rollback: ALTER TABLE ... DROP CONSTRAINT IF EXISTS <constraint_name> for each constraint below
-- Affected services: location-service

SET lock_timeout = '5s';

-- ============================================================================
-- location.locations.status
-- Valid states: active (schema default + commands.ts/repo.ts sample seeder;
-- no other transition implemented)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE location.locations
    ADD CONSTRAINT locations_status_check
    CHECK (status IN ('active'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- location.locations.type
-- Valid values: state, district, block, ward, office, facility, branch
-- (validators.ts LOCATION_TYPES — top of the branch-office hierarchy to leaf)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE location.locations
    ADD CONSTRAINT locations_type_check
    CHECK (type IN ('state', 'district', 'block', 'ward', 'office', 'facility', 'branch'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- NOTE: geofence.geofences.type and hierarchy.administrative_units.type
-- already use pgEnum types (geofence_type, unit_type) — no CHECK needed.
-- ============================================================================

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE location.locations VALIDATE CONSTRAINT locations_status_check;
ALTER TABLE location.locations VALIDATE CONSTRAINT locations_type_check;
