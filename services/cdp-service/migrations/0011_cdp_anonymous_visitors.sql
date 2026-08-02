-- Purpose: CR-CDP-04 — anonymous visitor register for identity stitching. A device/cookie
--          id is recorded as a SHA-256 hash only (the same hashing cdp.identity_graph uses
--          for email/phone) and points at the shell golden profile that carries the
--          visitor's pre-login events. When the visitor authenticates, those events,
--          identifiers and device edges are re-pointed at the known profile, the shell is
--          marked merged, and the join is recorded here plus in the profile's lineage.
--
--          Storing only a hash is a DPDP Act 2023 requirement in substance: a cookie id is
--          a pseudonymous identifier, and a hash is sufficient to recognise a returning
--          visitor without holding a value that could be replayed as a tracking key.
-- Rollback: DROP TABLE IF EXISTS cdp.anonymous_visitors;  (destructive — requires approval)
--           Rolling back loses the audit trail of past stitches. The stitches themselves
--           are already recorded in cdp.profiles (merged_from_ids, source_lineage), so no
--           customer data is lost.
-- Affected services: cdp-service (owner). Downstream services learn of a stitch from
--           cdp.identity.visitor_stitched and the accompanying cdp.profile.merged.
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS cdp.anonymous_visitors (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL,
  -- SHA-256 hex of "visitorId:<raw key>". The raw device/cookie id is never stored.
  visitor_key_hash       varchar(128) NOT NULL,
  anonymous_profile_id   uuid NOT NULL REFERENCES cdp.profiles(id),
  merged_into_profile_id uuid REFERENCES cdp.profiles(id),
  status                 varchar(16) NOT NULL DEFAULT 'anonymous'
                         CONSTRAINT anonymous_visitors_status_chk
                         CHECK (status IN ('anonymous', 'merged')),
  device_type            varchar(32) NOT NULL DEFAULT 'unknown',
  first_seen_at          timestamptz NOT NULL DEFAULT now(),
  last_seen_at           timestamptz NOT NULL DEFAULT now(),
  merged_at              timestamptz,
  -- Counts of what the stitch actually moved, so the claim is verifiable after the fact.
  events_merged          int NOT NULL DEFAULT 0,
  identifiers_merged     int NOT NULL DEFAULT 0,
  devices_merged         int NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NOT NULL,
  updated_by             uuid NOT NULL,
  version                int NOT NULL DEFAULT 1,
  -- A merged visitor must name the profile that absorbed it; an anonymous one must not.
  CONSTRAINT anonymous_visitors_merge_chk CHECK (
    (status = 'merged' AND merged_into_profile_id IS NOT NULL AND merged_at IS NOT NULL)
    OR (status = 'anonymous' AND merged_into_profile_id IS NULL)
  )
);

-- One register row per device/cookie id: a returning visitor is a heartbeat on the
-- existing row, never a second shell that would orphan the first one's events.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_anonymous_visitors_key
  ON cdp.anonymous_visitors (tenant_id, visitor_key_hash);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_anonymous_visitors_status
  ON cdp.anonymous_visitors (tenant_id, status, last_seen_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_anonymous_visitors_profile
  ON cdp.anonymous_visitors (tenant_id, anonymous_profile_id);

ALTER TABLE cdp.anonymous_visitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE cdp.anonymous_visitors FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anonymous_visitors_tenant_isolation ON cdp.anonymous_visitors;
CREATE POLICY anonymous_visitors_tenant_isolation ON cdp.anonymous_visitors
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cdp_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON cdp.anonymous_visitors TO cdp_svc;
  END IF;
END $g$;
