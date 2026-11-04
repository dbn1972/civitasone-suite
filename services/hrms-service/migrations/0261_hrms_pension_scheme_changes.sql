-- 0261_hrms_pension_scheme_changes.sql
--
-- UAT b18 D1 (EPF for contract staff, 2026-11-05): there was no way to change
-- an employee's pension scheme (the 6 contract staff were moved NPS -> EPF by
-- direct SQL, unaudited), and hrms_employees.pension_scheme carries no
-- effective date, so payroll applied whatever the column held to every period.
--
-- employee.hrms_pension_scheme_changes: one maker-checker request per change.
--   from_scheme / to_scheme  GPF | NPS | EPF | UPS (from may also be a legacy
--                            value such as CPF)
--   effective_from          first day of the wage month the new scheme starts
--   reason                  mandatory (>= 10 chars), copied into the audit event
--   uan_number              optional 12-digit UAN supplied with an EPF request;
--                           written to hrms_employees.uan_number on approval
--   status                  pending -> approved | rejected
--   requested_by / decided_by  maker / checker; the checker must differ
--   kind                    change (maker-checker request) | initial (backfill:
--                           the scheme on record when history began, from =
--                           to) | correction (backfill of a switch made outside
--                           this API, e.g. the UAT 2026-11-05 SQL switch)
--   applied_at              when hrms_employees.pension_scheme was switched (at
--                           approval if already effective, else by the worker
--                           tick on the effective date); NULL until then
-- Payroll reads the scheme IN EFFECT for each month from the approved rows
-- (internal payroll-input), so earlier periods keep the old scheme.
--
-- hrms_employees.pension_scheme: UPS (Unified Pension Scheme, an option under
-- NPS from 2025-04-01) becomes a valid recorded scheme. The check of 0063
-- (GPF / NPS / EPF / CPF) is replaced by the same list plus UPS; added NOT
-- VALID then validated so the long lock is only the brief one of ADD.
--
-- At most one pending request per employee (partial unique index).
-- Additive and idempotent. FORCE RLS on tenant_id like every employee table.
--
-- Rollback: DROP TABLE IF EXISTS employee.hrms_pension_scheme_changes;

SET lock_timeout = '5s';

ALTER TABLE employee.hrms_employees DROP CONSTRAINT IF EXISTS chk_hrms_employees_pension_scheme;
ALTER TABLE employee.hrms_employees
  ADD CONSTRAINT chk_hrms_employees_pension_scheme
  CHECK (pension_scheme IN ('GPF', 'NPS', 'EPF', 'CPF', 'UPS')) NOT VALID;
ALTER TABLE employee.hrms_employees VALIDATE CONSTRAINT chk_hrms_employees_pension_scheme;

CREATE TABLE IF NOT EXISTS employee.hrms_pension_scheme_changes (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  employee_id     uuid        NOT NULL,
  from_scheme     varchar(8)  NOT NULL,
  to_scheme       varchar(8)  NOT NULL,
  effective_from  date        NOT NULL,
  reason          text        NOT NULL,
  uan_number      varchar(12),
  status          varchar(16) NOT NULL DEFAULT 'pending',
  kind            varchar(16) NOT NULL DEFAULT 'change',
  requested_by    uuid        NOT NULL,
  decided_by      uuid,
  decided_at      timestamptz,
  decision_note   text,
  applied_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        NOT NULL,
  updated_by      uuid        NOT NULL,
  version         integer     NOT NULL DEFAULT 1,
  CONSTRAINT hrms_pension_scheme_changes_to_check CHECK (to_scheme IN ('GPF', 'NPS', 'EPF', 'UPS')),
  CONSTRAINT hrms_pension_scheme_changes_status_check CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT hrms_pension_scheme_changes_first_of_month CHECK (EXTRACT(DAY FROM effective_from) = 1),
  CONSTRAINT hrms_pension_scheme_changes_reason_check CHECK (length(btrim(reason)) >= 10),
  CONSTRAINT hrms_pension_scheme_changes_uan_check CHECK (uan_number IS NULL OR uan_number ~ '^[0-9]{12}$'),
  CONSTRAINT hrms_pension_scheme_changes_kind_check CHECK (kind IN ('change', 'initial', 'correction')),
  CONSTRAINT hrms_pension_scheme_changes_changed_check CHECK (kind = 'initial' OR from_scheme <> to_scheme),
  CONSTRAINT hrms_pension_scheme_changes_backfill_check CHECK (kind = 'change' OR status = 'approved'),
  CONSTRAINT hrms_pension_scheme_changes_decision_check CHECK (
    (status = 'pending' AND decided_by IS NULL) OR (status <> 'pending' AND decided_by IS NOT NULL AND decided_by <> requested_by))
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_hrms_pension_scheme_changes_employee'
      AND conrelid = 'employee.hrms_pension_scheme_changes'::regclass
  ) THEN
    ALTER TABLE employee.hrms_pension_scheme_changes
      ADD CONSTRAINT fk_hrms_pension_scheme_changes_employee
      FOREIGN KEY (employee_id) REFERENCES employee.hrms_employees(id) ON DELETE CASCADE;
  END IF;
END $$;

-- One open request per employee.
CREATE UNIQUE INDEX IF NOT EXISTS ux_hrms_pension_scheme_changes_pending
  ON employee.hrms_pension_scheme_changes (tenant_id, employee_id) WHERE status = 'pending';
-- The payroll-input history read and the worker tick (approved, not yet applied, due).
CREATE INDEX IF NOT EXISTS ix_hrms_pension_scheme_changes_tenant_emp
  ON employee.hrms_pension_scheme_changes (tenant_id, employee_id, status, effective_from);
CREATE INDEX IF NOT EXISTS ix_hrms_pension_scheme_changes_due
  ON employee.hrms_pension_scheme_changes (tenant_id, effective_from) WHERE status = 'approved' AND applied_at IS NULL;

ALTER TABLE employee.hrms_pension_scheme_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_pension_scheme_changes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_pension_scheme_changes;
CREATE POLICY tenant_isolation_policy ON employee.hrms_pension_scheme_changes
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON employee.hrms_pension_scheme_changes TO hrms_svc;
  END IF;
END $$;
