-- Purpose: CDP-004 — event taxonomy governance. Registry of approved event names,
--          their category, and the JSON schema each payload must satisfy before
--          the event store will accept it.
-- Rollback: DROP TABLE IF EXISTS cdp.event_taxonomy; (destructive — requires approval)
-- Affected services: cdp-service only
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS cdp.event_taxonomy (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  event_name  varchar(128) NOT NULL,
  category    varchar(64) NOT NULL DEFAULT 'behavioural',
  schema_json jsonb NOT NULL DEFAULT '{}',
  status      varchar(24) NOT NULL DEFAULT 'draft'
              CONSTRAINT event_taxonomy_status_chk
              CHECK (status IN ('draft', 'approved', 'deprecated')),
  version     int NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NOT NULL,
  updated_by  uuid NOT NULL
);

-- An event name is the governance key: one definition per tenant, so validation
-- can resolve a payload's contract by name alone.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_event_taxonomy_tenant_name
  ON cdp.event_taxonomy (tenant_id, event_name);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_event_taxonomy_tenant_status
  ON cdp.event_taxonomy (tenant_id, status);

ALTER TABLE cdp.event_taxonomy ENABLE ROW LEVEL SECURITY;
ALTER TABLE cdp.event_taxonomy FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_taxonomy_tenant_isolation ON cdp.event_taxonomy;
CREATE POLICY event_taxonomy_tenant_isolation ON cdp.event_taxonomy
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Guarded grant: the cdp_svc login role is owned by infra/db/bootstrap, so this
-- migration must stay runnable where it has not been provisioned yet.
DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cdp_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON cdp.event_taxonomy TO cdp_svc;
  END IF;
END $g$;
