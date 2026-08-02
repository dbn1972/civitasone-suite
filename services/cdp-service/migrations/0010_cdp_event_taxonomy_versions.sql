-- Purpose: CR-CDP-03 — versioned attribute schemas behind a registered event name.
--          cdp.event_taxonomy (0002, CDP-004) governs the event NAME and holds a single
--          current schema; this table keeps each revision of that schema as an immutable
--          row with its own lifecycle (draft → active → deprecated), so an event ingested
--          under an older contract can still be validated against the contract that was
--          in force at the time. Exactly one revision per event name is active; activating
--          a new one deprecates its predecessor in the same transaction.
-- Rollback: DROP TABLE IF EXISTS cdp.event_taxonomy_versions;  (destructive — requires approval)
--           Rolling back leaves cdp.event_taxonomy and its single current schema intact,
--           so CDP-004 validation continues to work; only revision history is lost.
-- Affected services: cdp-service (owner). Producers learn of activations through the
--           cdp.event_taxonomy_version.activated event, not by reading this table.
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS cdp.event_taxonomy_versions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  taxonomy_id    uuid NOT NULL REFERENCES cdp.event_taxonomy(id) ON DELETE CASCADE,
  -- Contract revision number (business-visible, monotonic per event name). Distinct from
  -- `version`, which is the optimistic-lock counter every entity carries.
  schema_version int NOT NULL CONSTRAINT event_taxonomy_versions_number_chk CHECK (schema_version >= 1),
  schema_json    jsonb NOT NULL DEFAULT '{}'::jsonb,
  status         varchar(16) NOT NULL DEFAULT 'draft'
                 CONSTRAINT event_taxonomy_versions_status_chk
                 CHECK (status IN ('draft', 'active', 'deprecated')),
  notes          varchar(500),
  activated_at   timestamptz,
  deprecated_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  updated_by     uuid NOT NULL,
  version        int NOT NULL DEFAULT 1
);

-- A revision number is never reused, even after deprecation: an archived event that cites
-- schema_version 3 must resolve to exactly one contract.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_event_taxonomy_versions_number
  ON cdp.event_taxonomy_versions (tenant_id, taxonomy_id, schema_version);

-- Partial unique index: at most one ACTIVE revision per event name. The route deprecates
-- the predecessor in the same transaction, but the invariant is enforced by the database
-- rather than trusted to application ordering.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_event_taxonomy_versions_active
  ON cdp.event_taxonomy_versions (tenant_id, taxonomy_id)
  WHERE status = 'active';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_event_taxonomy_versions_taxonomy
  ON cdp.event_taxonomy_versions (tenant_id, taxonomy_id, status);

ALTER TABLE cdp.event_taxonomy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cdp.event_taxonomy_versions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_taxonomy_versions_tenant_isolation ON cdp.event_taxonomy_versions;
CREATE POLICY event_taxonomy_versions_tenant_isolation ON cdp.event_taxonomy_versions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cdp_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON cdp.event_taxonomy_versions TO cdp_svc;
  END IF;
END $g$;
