-- Purpose: CDP-005 — dynamic segmentation. Materialised membership of a profile in
--          a segment, written by batch recompute and by real-time evaluation.
-- Rollback: DROP TABLE IF EXISTS cdp.segment_memberships; (destructive — requires approval)
-- Affected services: cdp-service only
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS cdp.segment_memberships (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  segment_id  uuid NOT NULL REFERENCES cdp.segments(id),
  profile_id  uuid NOT NULL REFERENCES cdp.profiles(id),
  computed_at timestamptz NOT NULL DEFAULT now(),
  -- Distinguishes a row written by streaming evaluation from one written by the
  -- scheduled recompute, so a batch sweep can refresh its own rows without
  -- discarding fresher real-time entries.
  is_realtime boolean NOT NULL DEFAULT false,
  version     int NOT NULL DEFAULT 1
);

-- One membership row per (segment, profile): recompute upserts against this key.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_segment_memberships_tenant_segment_profile
  ON cdp.segment_memberships (tenant_id, segment_id, profile_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_segment_memberships_segment
  ON cdp.segment_memberships (tenant_id, segment_id, computed_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_segment_memberships_profile
  ON cdp.segment_memberships (tenant_id, profile_id);

ALTER TABLE cdp.segment_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE cdp.segment_memberships FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS segment_memberships_tenant_isolation ON cdp.segment_memberships;
CREATE POLICY segment_memberships_tenant_isolation ON cdp.segment_memberships
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cdp_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON cdp.segment_memberships TO cdp_svc;
  END IF;
END $g$;
