-- Purpose: Create missing FK indexes using CREATE INDEX CONCURRENTLY for non-blocking index creation.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS each index listed below.
-- Affected services: location-service only.
-- Safety: IF NOT EXISTS ensures idempotency. CONCURRENTLY avoids table locks.
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.

SET lock_timeout = '5s';

-- hierarchy.administrative_units.parent_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_administrative_units_parent_id
  ON hierarchy.administrative_units (parent_id);

-- jurisdiction.jurisdictions.office_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jurisdictions_office_id
  ON jurisdiction.jurisdictions (office_id);

-- jurisdiction.jurisdictions.unit_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jurisdictions_unit_id
  ON jurisdiction.jurisdictions (unit_id);

-- location.locations.parent_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_locations_parent_id
  ON location.locations (parent_id);
