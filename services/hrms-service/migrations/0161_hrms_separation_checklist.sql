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
--
-- RLS: PR #1715 review found this table shipped with no RLS at all (every
-- other lifecycle.* table has it, including lifecycle.hrms_separations
-- itself, the direct FK parent here). Convention used below is
-- employee.current_tenant_id() + tenant_isolation_policy, matching
-- hrms_separations' own policy (0034_rls_full_tenant_isolation.sql) and the
-- dominant convention across this service (0026/0034/0123/0135/0138/0148/
-- 0150) -- not lifecycle.hrms_onboarding_documents' (0140) inline
-- current_setting()+<table>_tenant naming, which is a minority pattern
-- (also used in 0134) that 0148/0150 (both later) reverted away from. Both
-- predicates read the same app.tenant_id GUC and are equivalent in the
-- normal case; this picks the one matching the direct parent table and the
-- rest of the service.

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

ALTER TABLE lifecycle.hrms_separation_checklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifecycle.hrms_separation_checklist FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON lifecycle.hrms_separation_checklist;
CREATE POLICY tenant_isolation_policy ON lifecycle.hrms_separation_checklist
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

ALTER TABLE lifecycle.hrms_separations
  ADD COLUMN IF NOT EXISTS ppo_issued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ppo_issued_by UUID;
