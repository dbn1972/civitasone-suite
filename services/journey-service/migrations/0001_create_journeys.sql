-- 0001_create_journeys.sql
-- Initial schema for journey-service: multi-step campaign orchestration blueprints.
-- Additive + idempotent. FORCE RLS on app.tenant_id GUC.
--
-- Rollback:
--   DROP TABLE IF EXISTS journey.journeys;
--   DROP SCHEMA IF EXISTS journey;

SET lock_timeout = '5s';

-- ── Schema ─────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS journey;

-- ── Journeys table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS journey.journeys (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  name           varchar(200) NOT NULL,
  status         varchar(24) NOT NULL DEFAULT 'draft',
  trigger_config jsonb,
  steps          jsonb NOT NULL DEFAULT '[]'::jsonb,
  version        integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  updated_by     uuid NOT NULL,
  CONSTRAINT journeys_status_check CHECK (status IN ('draft','active','paused','archived'))
);

CREATE INDEX IF NOT EXISTS journeys_tenant_idx ON journey.journeys (tenant_id);
CREATE INDEX IF NOT EXISTS journeys_tenant_status_idx ON journey.journeys (tenant_id, status);

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE journey.journeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey.journeys FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS journeys_tenant_isolation ON journey.journeys;
CREATE POLICY journeys_tenant_isolation ON journey.journeys
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DO $grant$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'journey_svc') THEN GRANT SELECT, INSERT, UPDATE, DELETE ON journey.journeys TO journey_svc; END IF; END $grant$;
