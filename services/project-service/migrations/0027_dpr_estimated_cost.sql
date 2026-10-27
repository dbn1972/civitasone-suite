-- GAP-PROJECTS-DPR-TRACKING-02 (owner decision D4c #34): the estimated cost of a DPR
-- is stored as whole paise (bigint) like every other money field in this service.
-- The DPR list used to return the placeholder string "—" because nothing stored it.
--
-- Additive and idempotent. Nullable with no DEFAULT on purpose: a DPR submitted
-- before this migration has no recorded estimate, and NULL ("not recorded") is the
-- honest value for it; a DEFAULT 0 would invent a zero-rupee estimate.
--
-- Rollback: ALTER TABLE progress.project_dprs
--   DROP CONSTRAINT IF EXISTS project_dprs_estimated_cost_nonneg,
--   DROP COLUMN IF EXISTS estimated_cost_minor;
-- Affected services: project-service (progress module)

SET lock_timeout = '5s';

ALTER TABLE progress.project_dprs
  ADD COLUMN IF NOT EXISTS estimated_cost_minor bigint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_dprs_estimated_cost_nonneg'
  ) THEN
    ALTER TABLE progress.project_dprs
      ADD CONSTRAINT project_dprs_estimated_cost_nonneg
      CHECK (estimated_cost_minor IS NULL OR estimated_cost_minor >= 0);
  END IF;
END $$;
