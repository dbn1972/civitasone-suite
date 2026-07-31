-- 0002_journey_foundation.sql
-- Foundation tables for step executions, triggers, and journey executions.
-- Additive + idempotent. RLS forced on app.tenant_id GUC.
--
-- Rollback:
--   DROP TABLE IF EXISTS journey.journey_executions;
--   DROP TABLE IF EXISTS journey.triggers;
--   DROP TABLE IF EXISTS journey.step_executions;

SET lock_timeout = '5s';

-- ── Step Executions table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS journey.step_executions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  journey_id     uuid NOT NULL,
  profile_id     uuid NOT NULL,
  step_index     integer NOT NULL,
  status         varchar(24) NOT NULL DEFAULT 'pending',
  executed_at    timestamptz,
  version        integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  updated_by     uuid NOT NULL,
  CONSTRAINT step_executions_status_check CHECK (status IN ('pending','executing','completed','failed','skipped'))
);

CREATE INDEX IF NOT EXISTS step_exec_tenant_idx ON journey.step_executions (tenant_id);
CREATE INDEX IF NOT EXISTS step_exec_journey_idx ON journey.step_executions (journey_id);
CREATE INDEX IF NOT EXISTS step_exec_profile_idx ON journey.step_executions (profile_id);
CREATE INDEX IF NOT EXISTS step_exec_status_idx ON journey.step_executions (tenant_id, status);

ALTER TABLE journey.step_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey.step_executions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS step_executions_tenant_isolation ON journey.step_executions;
CREATE POLICY step_executions_tenant_isolation ON journey.step_executions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON journey.step_executions TO journey_svc;

-- ── Triggers table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS journey.triggers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  journey_id     uuid NOT NULL,
  trigger_type   varchar(32) NOT NULL,
  config         jsonb NOT NULL DEFAULT '{}'::jsonb,
  status         varchar(24) NOT NULL DEFAULT 'active',
  version        integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  updated_by     uuid NOT NULL,
  CONSTRAINT triggers_type_check CHECK (trigger_type IN ('event_based','time_based','segment_entry')),
  CONSTRAINT triggers_status_check CHECK (status IN ('active','paused','inactive'))
);

CREATE INDEX IF NOT EXISTS triggers_tenant_idx ON journey.triggers (tenant_id);
CREATE INDEX IF NOT EXISTS triggers_journey_idx ON journey.triggers (journey_id);
CREATE INDEX IF NOT EXISTS triggers_status_idx ON journey.triggers (tenant_id, status);

ALTER TABLE journey.triggers ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey.triggers FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS triggers_tenant_isolation ON journey.triggers;
CREATE POLICY triggers_tenant_isolation ON journey.triggers
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON journey.triggers TO journey_svc;

-- ── Journey Executions table ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS journey.journey_executions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  journey_id          uuid NOT NULL,
  profile_id          uuid NOT NULL,
  status              varchar(24) NOT NULL DEFAULT 'enrolled',
  current_step_index  integer NOT NULL DEFAULT 0,
  enrolled_at         timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  version             integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL,
  updated_by          uuid NOT NULL,
  CONSTRAINT journey_exec_status_check CHECK (status IN ('enrolled','in_progress','completed','exited'))
);

CREATE INDEX IF NOT EXISTS journey_exec_tenant_idx ON journey.journey_executions (tenant_id);
CREATE INDEX IF NOT EXISTS journey_exec_journey_idx ON journey.journey_executions (journey_id);
CREATE INDEX IF NOT EXISTS journey_exec_profile_idx ON journey.journey_executions (profile_id);
CREATE INDEX IF NOT EXISTS journey_exec_status_idx ON journey.journey_executions (tenant_id, status);

ALTER TABLE journey.journey_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey.journey_executions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS journey_exec_tenant_isolation ON journey.journey_executions;
CREATE POLICY journey_exec_tenant_isolation ON journey.journey_executions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON journey.journey_executions TO journey_svc;
