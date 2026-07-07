-- Purpose: Add CHECK constraints on remaining status/type columns lacking them (follow-up to 0007_check_constraints_status_columns.sql)
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: location-service

SET lock_timeout = '5s';

-- ============================================================================
-- jurisdiction.jurisdictions.level
-- Valid states: state, district, block, gp, ward, zone
-- (validators.ts JURISDICTION_LEVELS const; zod enum enforces on create/update)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE jurisdiction.jurisdictions
    ADD CONSTRAINT jurisdictions_level_check
    CHECK (level IN ('state', 'district', 'block', 'gp', 'ward', 'zone'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- NOTE: location.locations.status — already constrained by
-- locations_status_check (0007) covering ('active'). Nothing to add.
-- ============================================================================

-- ============================================================================
-- NOTE: location.locations.type — already constrained by
-- locations_type_check (0007) covering
-- ('state','district','block','ward','office','facility','branch').
-- Nothing to add.
-- ============================================================================

-- ============================================================================
-- NOTE: geofence.geofences.type and hierarchy.administrative_units.type
-- already use pgEnum types (geofence_type, unit_type) — no CHECK needed.
-- ============================================================================

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE jurisdiction.jurisdictions VALIDATE CONSTRAINT jurisdictions_level_check;
