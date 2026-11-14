-- 0166_project_costing.sql
--
-- S8 G7 (project-linked staff costing, MIS layer v1). Design:
-- ~/orch-logs/segments/section8-design.md section 8.
--
-- 1. payroll.payroll_settings.project_costing_enabled: per-tenant switch, default
--    FALSE. project_cost_min_cohort: the fewest distinct costed people behind a
--    cell that a reader who may see totals but not individual pay is shown
--    (default 3, never below 2 - a one-person total is that person's pay). While it is false nothing below is read or written by a run, so the
--    migration is a no-op for every existing tenant.
-- 2. payroll.employee_cost_allocations: an employee's cost charged to a project
--    or a cost centre, split_pct (2 dp) from effective_from to effective_to.
--    Maker-checker: pending -> active (approved) / rejected; the approver is not
--    the requester. The "sum of an employee's lines is at most 100% on every
--    day" rule is enforced by the consumer under a per-employee advisory lock
--    (it needs a date-range sweep, not a row CHECK).
-- 3. payroll.slip_cost_lines: immutable cost lines written when a run is
--    approved (kind 'run'), plus reclassification deltas (kind 'reclass') when
--    an allocation change is back-dated over months that were already costed.
--    Approved runs and their 'run' lines are never rewritten.
--    A project line must also carry the project's cost centre (design 8.2).
--
-- Additive and idempotent; old code ignores the new column and tables.
--
-- Rollback:
--   DROP TABLE IF EXISTS payroll.slip_cost_lines;
--   DROP TABLE IF EXISTS payroll.employee_cost_allocations;
--   DROP FUNCTION IF EXISTS payroll.slip_cost_lines_guard();
--   ALTER TABLE payroll.payroll_settings DROP COLUMN IF EXISTS project_costing_enabled, DROP COLUMN IF EXISTS project_cost_min_cohort;
-- Affected services: payroll-service

SET lock_timeout = '5s';

ALTER TABLE payroll.payroll_settings
  ADD COLUMN IF NOT EXISTS project_costing_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE payroll.payroll_settings
  ADD COLUMN IF NOT EXISTS project_cost_min_cohort integer NOT NULL DEFAULT 3;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_settings_min_cohort_chk') THEN
    ALTER TABLE payroll.payroll_settings
      ADD CONSTRAINT payroll_settings_min_cohort_chk CHECK (project_cost_min_cohort >= 2);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS payroll.employee_cost_allocations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  employee_id     uuid NOT NULL,
  target_type     varchar(16) NOT NULL,
  project_id      uuid,
  cost_center_id  uuid,
  split_pct       numeric(5,2) NOT NULL,
  effective_from  date NOT NULL,
  effective_to    date,
  status          varchar(16) NOT NULL DEFAULT 'pending',
  note            text,
  requested_by    uuid NOT NULL,
  decided_by      uuid,
  decided_at      timestamptz,
  decision_note   text,
  ended_by        uuid,
  ended_at        timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  version         integer NOT NULL DEFAULT 1,
  CONSTRAINT eca_target_type_chk CHECK (target_type IN ('project', 'cost_center')),
  CONSTRAINT eca_target_shape_chk CHECK (
    (target_type = 'project'     AND project_id IS NOT NULL AND cost_center_id IS NOT NULL) OR
    (target_type = 'cost_center' AND project_id IS NULL     AND cost_center_id IS NOT NULL)),
  CONSTRAINT eca_split_chk CHECK (split_pct > 0 AND split_pct <= 100),
  CONSTRAINT eca_dates_chk CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT eca_status_chk CHECK (status IN ('pending', 'active', 'rejected')),
  CONSTRAINT eca_decision_chk CHECK (
    (status = 'pending' AND decided_by IS NULL) OR
    (status <> 'pending' AND decided_by IS NOT NULL AND decided_by <> requested_by))
);

CREATE INDEX IF NOT EXISTS ix_eca_tenant_employee
  ON payroll.employee_cost_allocations (tenant_id, employee_id, status);
CREATE INDEX IF NOT EXISTS ix_eca_tenant_project
  ON payroll.employee_cost_allocations (tenant_id, project_id) WHERE project_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS payroll.slip_cost_lines (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  kind                  varchar(8) NOT NULL DEFAULT 'run',
  cost_month            char(7) NOT NULL,
  run_id                uuid NOT NULL,
  slip_id               uuid NOT NULL,
  employee_id           uuid NOT NULL,
  line_key              text NOT NULL,
  allocation_id         uuid,
  target_type           varchar(16) NOT NULL,
  project_id            uuid,
  cost_center_id        uuid,
  split_bps             integer,
  gross_minor           bigint NOT NULL DEFAULT 0,
  employer_pf_minor     bigint NOT NULL DEFAULT 0,
  employer_esi_minor    bigint NOT NULL DEFAULT 0,
  employer_nps_minor    bigint NOT NULL DEFAULT 0,
  other_employer_minor  bigint NOT NULL DEFAULT 0,
  total_cost_minor      bigint NOT NULL DEFAULT 0,
  reclass_batch_id      uuid,
  booked_run_id         uuid,
  booked_month          char(7),
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scl_kind_chk CHECK (kind IN ('run', 'reclass')),
  CONSTRAINT scl_target_chk CHECK (target_type IN ('project', 'cost_center', 'unallocated')),
  CONSTRAINT scl_total_chk CHECK (
    total_cost_minor = gross_minor + employer_pf_minor + employer_esi_minor + employer_nps_minor + other_employer_minor),
  CONSTRAINT scl_reclass_batch_chk CHECK ((kind = 'reclass') = (reclass_batch_id IS NOT NULL))
);

-- A run is costed once: re-running the generator (retry, manual regenerate) cannot duplicate a line.
CREATE UNIQUE INDEX IF NOT EXISTS ux_scl_run_line
  ON payroll.slip_cost_lines (tenant_id, slip_id, line_key) WHERE kind = 'run';
CREATE UNIQUE INDEX IF NOT EXISTS ux_scl_reclass_line
  ON payroll.slip_cost_lines (tenant_id, slip_id, line_key, reclass_batch_id) WHERE kind = 'reclass';
CREATE INDEX IF NOT EXISTS ix_scl_tenant_month_project
  ON payroll.slip_cost_lines (tenant_id, cost_month, project_id);
CREATE INDEX IF NOT EXISTS ix_scl_tenant_run ON payroll.slip_cost_lines (tenant_id, run_id);
CREATE INDEX IF NOT EXISTS ix_scl_tenant_employee ON payroll.slip_cost_lines (tenant_id, employee_id, cost_month);

-- Immutability: cost lines are never deleted; the only permitted UPDATE stamps a reclass
-- delta with the run that booked it (booked_run_id / booked_month, once).
CREATE OR REPLACE FUNCTION payroll.slip_cost_lines_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'slip_cost_lines rows are immutable (delete refused)';
  END IF;
  IF OLD.kind = 'reclass' AND OLD.booked_run_id IS NULL
     AND (to_jsonb(NEW) - 'booked_run_id' - 'booked_month') = (to_jsonb(OLD) - 'booked_run_id' - 'booked_month') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'slip_cost_lines rows are immutable (update refused)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_slip_cost_lines_guard ON payroll.slip_cost_lines;
CREATE TRIGGER trg_slip_cost_lines_guard
  BEFORE UPDATE OR DELETE ON payroll.slip_cost_lines
  FOR EACH ROW EXECUTE FUNCTION payroll.slip_cost_lines_guard();

ALTER TABLE payroll.employee_cost_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.employee_cost_allocations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.employee_cost_allocations;
CREATE POLICY tenant_isolation_policy ON payroll.employee_cost_allocations
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

ALTER TABLE payroll.slip_cost_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.slip_cost_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.slip_cost_lines;
CREATE POLICY tenant_isolation_policy ON payroll.slip_cost_lines
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());
