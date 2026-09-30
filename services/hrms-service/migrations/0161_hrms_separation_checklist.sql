-- 0159_hrms_separation_checklist.sql
--
-- GAP-HR-RETIREMENT-01: the 5-step retirement-processing checklist had no
-- backend at all -- state lived in React useState only and reset on every
-- reload or whenever a different officer opened the same case. "Issue PPO"
-- was a styled <span>, not a working action, and nothing was audited.
-- Decision packet (Theme 1, GAP-HR-RETIREMENT-01): persist the checklist
-- server-side and wire a real Issue PPO action, gated to HR admin,
-- requiring all checks complete, fully audited.
--
-- One row per (separation, step, check-index); toggled individually via
-- PUT /v1/hrms/separations/:id/checklist. ppo_issued_at/by on
-- hrms_separations itself record the one-time, irreversible "PPO issued"
-- event (POST .../issue-ppo), refused unless every row here is done.

CREATE TABLE IF NOT EXISTS lifecycle.hrms_separation_checklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  separation_id UUID NOT NULL REFERENCES lifecycle.hrms_separations(id),
  step_id VARCHAR(32) NOT NULL,
  check_index INTEGER NOT NULL,
  done BOOLEAN NOT NULL DEFAULT FALSE,
  done_by UUID,
  done_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, separation_id, step_id, check_index)
);

CREATE INDEX IF NOT EXISTS hrms_separation_checklist_sep_idx
  ON lifecycle.hrms_separation_checklist (tenant_id, separation_id);

ALTER TABLE lifecycle.hrms_separations
  ADD COLUMN IF NOT EXISTS ppo_issued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ppo_issued_by UUID;
