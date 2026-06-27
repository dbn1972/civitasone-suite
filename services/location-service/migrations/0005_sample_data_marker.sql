-- location-service: sample-data marker.
-- Additive, idempotent, forward-only. Safe to re-run.
-- Marks clearly-labelled example offices a new tenant can add to explore, then
-- clear in one action. Clearing deletes ONLY rows where is_sample = true, so a
-- clerk's real offices are never affected.

ALTER TABLE location.locations
  ADD COLUMN IF NOT EXISTS is_sample boolean NOT NULL DEFAULT false;

-- Supports tenant-scoped "delete only my sample rows" without scanning real data.
CREATE INDEX IF NOT EXISTS idx_locations_tenant_sample
  ON location.locations(tenant_id, is_sample);
