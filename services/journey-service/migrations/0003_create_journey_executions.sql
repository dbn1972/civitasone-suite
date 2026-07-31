-- 0002_create_journey_executions.sql
-- Purpose: journey execution instances — tracks profile enrollment and progress
--          through a journey (state machine: enrolled → in_progress →
--          completed / exited). Backs src/modules/executions/schema.ts.
-- Affected services: journey-service only (civitas_journey).
-- Additive + idempotent. FORCE RLS on app.tenant_id GUC.
--
-- Rollback:
--   DROP TABLE IF EXISTS journey.journey_executions;

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS journey;

-- ── Journey executions table ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS journey.journey_executions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  journey_id         uuid NOT NULL,
  profile_id         uuid NOT NULL,
  status             varchar(24) NOT NULL DEFAULT 'enrolled',
  current_step_index integer NOT NULL DEFAULT 0,
  enrolled_at        timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz,
  version            integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NOT NULL,
  updated_by         uuid NOT NULL,
  CONSTRAINT journey_executions_status_check
    CHECK (status IN ('enrolled','in_progress','completed','exited')),
  CONSTRAINT journey_executions_step_index_check
    CHECK (current_step_index >= 0)
);

-- List/filter paths: tenant scope, per-journey, per-profile, per-status
-- (repo.listByTenant orders by enrolled_at DESC).
CREATE INDEX IF NOT EXISTS journey_executions_tenant_enrolled_idx
  ON journey.journey_executions (tenant_id, enrolled_at DESC);
CREATE INDEX IF NOT EXISTS journey_executions_tenant_journey_idx
  ON journey.journey_executions (tenant_id, journey_id);
CREATE INDEX IF NOT EXISTS journey_executions_tenant_profile_idx
  ON journey.journey_executions (tenant_id, profile_id);
CREATE INDEX IF NOT EXISTS journey_executions_tenant_status_idx
  ON journey.journey_executions (tenant_id, status);

-- At most one non-terminal enrollment per (journey, profile) — a profile cannot
-- be enrolled twice in the same journey while a run is still in flight.
-- Re-enrollment after completed/exited is allowed.
CREATE UNIQUE INDEX IF NOT EXISTS journey_executions_active_enrollment_uidx
  ON journey.journey_executions (tenant_id, journey_id, profile_id)
  WHERE status IN ('enrolled','in_progress');

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE journey.journey_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey.journey_executions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS journey_executions_tenant_isolation ON journey.journey_executions;
CREATE POLICY journey_executions_tenant_isolation ON journey.journey_executions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DO $grant$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'journey_svc') THEN GRANT SELECT, INSERT, UPDATE, DELETE ON journey.journey_executions TO journey_svc; END IF; END $grant$;
