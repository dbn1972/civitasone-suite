-- 0016_stage_lifecycle_status.sql
-- The step lifecycle verbs (run / skip / retry on /v1/install/steps/:id/:verb)
-- move an install.stages row through pending -> in_progress -> completed |
-- failed | skipped. Migration 0007 constrained status to
-- ('active','completed','skipped'), so in_progress / failed / pending could never
-- be persisted. Widen the CHECK to the full lifecycle vocabulary the web
-- (InstallStepSummarySchema) and the consumer use. 'active' stays valid: it is
-- the legacy create-time default (treated as pending everywhere).
SET lock_timeout = '5s';

ALTER TABLE install.stages DROP CONSTRAINT IF EXISTS stages_status_check;
ALTER TABLE install.stages
  ADD CONSTRAINT stages_status_check
  CHECK (status IN ('active', 'pending', 'in_progress', 'completed', 'failed', 'skipped'))
  NOT VALID;
ALTER TABLE install.stages VALIDATE CONSTRAINT stages_status_check;
