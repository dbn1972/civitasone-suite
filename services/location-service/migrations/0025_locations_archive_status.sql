-- 0025_locations_archive_status.sql
--
-- GAP-HR-LOCATIONS-02: a location can be archived (soft-removed from active use)
-- or deactivated, but 0007_check_constraints_status_columns.sql pinned
-- location.locations.status to ('active') only, so the status could never
-- change. Widen the CHECK to the three lifecycle states the API now accepts:
--   active    -- in use (the only state before this migration)
--   inactive  -- temporarily not in use
--   archived  -- retired; hidden from active operations, kept for history
-- Existing rows are all 'active', so the new constraint validates trivially.
-- Idempotent.

ALTER TABLE location.locations DROP CONSTRAINT IF EXISTS locations_status_check;
ALTER TABLE location.locations
  ADD CONSTRAINT locations_status_check CHECK (status IN ('active', 'inactive', 'archived'));
