-- 0005_step_dispatch.sql
-- Purpose: P1-8 — real stepType dispatch. Records WHAT a step execution did and
--          how it ended, and gives a `wait` step a durable resume deadline so a
--          parked run survives a worker restart.
-- Affected services: journey-service only (civitas_journey). No cross-service FK.
-- Additive + idempotent. Existing rows keep working: every new column is
-- NULLable with no default, and the widened status CHECK is a superset of the
-- old one, so this migration can be applied before the new worker is deployed.
--
-- Rollback:
--   ALTER TABLE journey.step_executions DROP CONSTRAINT IF EXISTS step_executions_status_check;
--   ALTER TABLE journey.step_executions ADD CONSTRAINT step_executions_status_check
--     CHECK (status IN ('pending','executing','completed','failed','skipped'));
--   DROP INDEX IF EXISTS journey.step_exec_due_waits_idx;
--   ALTER TABLE journey.step_executions
--     DROP COLUMN IF EXISTS step_type,
--     DROP COLUMN IF EXISTS total_steps,
--     DROP COLUMN IF EXISTS resume_at,
--     DROP COLUMN IF EXISTS failure_code,
--     DROP COLUMN IF EXISTS failure_reason;

SET lock_timeout = '5s';

-- ── Dispatch outcome columns ───────────────────────────────────────────────
-- ADD COLUMN ... NULL with no default is metadata-only on PG 16 (no table
-- rewrite, no long ACCESS EXCLUSIVE hold).
ALTER TABLE journey.step_executions
  ADD COLUMN IF NOT EXISTS step_type      varchar(32),
  ADD COLUMN IF NOT EXISTS total_steps    integer,
  ADD COLUMN IF NOT EXISTS resume_at      timestamptz,
  ADD COLUMN IF NOT EXISTS failure_code   varchar(48),
  ADD COLUMN IF NOT EXISTS failure_reason text;

-- ── `waiting` status ───────────────────────────────────────────────────────
-- A `wait` step parks here until resume_at elapses. Replacing the CHECK with a
-- superset never invalidates an existing row, so no validation scan can fail.
ALTER TABLE journey.step_executions
  DROP CONSTRAINT IF EXISTS step_executions_status_check;
ALTER TABLE journey.step_executions
  ADD CONSTRAINT step_executions_status_check
  CHECK (status IN ('pending','executing','waiting','completed','failed','skipped'));

-- Only the dispatched types are accepted; NULL is allowed for rows written by
-- the previous stub, which never recorded a type.
ALTER TABLE journey.step_executions
  DROP CONSTRAINT IF EXISTS step_executions_step_type_check;
ALTER TABLE journey.step_executions
  ADD CONSTRAINT step_executions_step_type_check
  CHECK (step_type IS NULL OR step_type IN ('send_notification','wait','condition_check','api_call'));

ALTER TABLE journey.step_executions
  DROP CONSTRAINT IF EXISTS step_executions_total_steps_check;
ALTER TABLE journey.step_executions
  ADD CONSTRAINT step_executions_total_steps_check
  CHECK (total_steps IS NULL OR total_steps > 0);

-- ── Wait sweeper index ─────────────────────────────────────────────────────
-- The sweeper's only query is "waiting steps whose resume_at is due", ordered by
-- resume_at. Partial, so it stays tiny however many completed steps accumulate.
CREATE INDEX IF NOT EXISTS step_exec_due_waits_idx
  ON journey.step_executions (resume_at)
  WHERE status = 'waiting';

-- ── RLS (re-asserted; table created with FORCE RLS in 0002) ────────────────
-- Idempotent, and keeps this file self-contained if the table is ever recreated.
ALTER TABLE journey.step_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey.step_executions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS step_executions_tenant_isolation ON journey.step_executions;
CREATE POLICY step_executions_tenant_isolation ON journey.step_executions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DO $grant$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'journey_svc') THEN GRANT SELECT, INSERT, UPDATE, DELETE ON journey.step_executions TO journey_svc; END IF; END $grant$;
