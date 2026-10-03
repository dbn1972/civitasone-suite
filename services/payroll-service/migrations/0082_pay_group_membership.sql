-- 0082_pay_group_membership.sql
--
-- GAP-PAYROLL-PAY-GROUPS-03 (remainder): pay-group membership.
-- Idempotent (re-runnable). Tenant tables FORCE RLS.
--
--  * pay_groups gain an optional DDO (ddo_code, same tenant) and a bill type
--    -- Govt payroll is organised by DDO and pay bill (gazetted establishment
--    bill, non-gazetted establishment bill, contractual / outsourced staff).
--  * employee_pay_group_assignments: effective-dated membership, ONE pay group
--    per employee at any date, history kept. effective_to is EXCLUSIVE (the
--    first day the employee is no longer in the group); NULL = open-ended.
--    employee_id is the hrms employee id (no cross-schema FK).
--  * pay_group_settings: per-tenant switch allowing a membership change to
--    start on a day other than the 1st of a month (default: 1st only).

ALTER TABLE payroll.pay_groups ADD COLUMN IF NOT EXISTS ddo_code VARCHAR(32);
ALTER TABLE payroll.pay_groups ADD COLUMN IF NOT EXISTS bill_type VARCHAR(16) NOT NULL DEFAULT 'other';
DO $$ BEGIN
  ALTER TABLE payroll.pay_groups ADD CONSTRAINT pay_groups_bill_type_check
    CHECK (bill_type IN ('gazetted', 'non_gazetted', 'contract', 'casual', 'other'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE payroll.pay_groups ADD CONSTRAINT pay_groups_ddo_fk
    FOREIGN KEY (tenant_id, ddo_code) REFERENCES payroll.payroll_ddos (tenant_id, ddo_code);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS ix_pay_groups_tenant_ddo ON payroll.pay_groups (tenant_id, ddo_code) WHERE ddo_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS payroll.employee_pay_group_assignments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL,
  employee_id    UUID        NOT NULL,
  pay_group_id   UUID        NOT NULL REFERENCES payroll.pay_groups (id),
  effective_from DATE        NOT NULL,
  effective_to   DATE,
  reason         TEXT,
  end_reason     TEXT,
  created_by     UUID        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_by       UUID,
  ended_at       TIMESTAMPTZ,
  CONSTRAINT epga_period_check CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE INDEX IF NOT EXISTS ix_epga_group ON payroll.employee_pay_group_assignments (tenant_id, pay_group_id, effective_from);
CREATE INDEX IF NOT EXISTS ix_epga_employee ON payroll.employee_pay_group_assignments (tenant_id, employee_id, effective_from);
-- At most one open-ended assignment per employee.
CREATE UNIQUE INDEX IF NOT EXISTS ux_epga_one_open
  ON payroll.employee_pay_group_assignments (tenant_id, employee_id) WHERE effective_to IS NULL;

-- DB-level guarantee: an employee's assignment periods never overlap (so at
-- any date the employee is in at most one pay group). Serialised per employee
-- with a transaction-scoped advisory lock, so two concurrent inserts cannot
-- both pass the check. (An exclusion constraint would need btree_gist.)
CREATE OR REPLACE FUNCTION payroll.epga_no_overlap() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('epga:' || NEW.tenant_id::text || ':' || NEW.employee_id::text, 0));
  IF EXISTS (
    SELECT 1 FROM payroll.employee_pay_group_assignments o
     WHERE o.tenant_id = NEW.tenant_id AND o.employee_id = NEW.employee_id AND o.id <> NEW.id
       AND o.effective_from < COALESCE(NEW.effective_to, 'infinity'::date)
       AND COALESCE(o.effective_to, 'infinity'::date) > NEW.effective_from
  ) THEN
    RAISE EXCEPTION 'EMPLOYEE_PAY_GROUP_OVERLAP: employee already has a pay-group assignment overlapping % .. %',
      NEW.effective_from, COALESCE(NEW.effective_to::text, 'open') USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS trg_epga_no_overlap ON payroll.employee_pay_group_assignments;
CREATE TRIGGER trg_epga_no_overlap
  BEFORE INSERT OR UPDATE OF employee_id, effective_from, effective_to ON payroll.employee_pay_group_assignments
  FOR EACH ROW EXECUTE FUNCTION payroll.epga_no_overlap();

ALTER TABLE payroll.employee_pay_group_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.employee_pay_group_assignments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.employee_pay_group_assignments;
CREATE POLICY tenant_isolation_policy ON payroll.employee_pay_group_assignments
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

CREATE TABLE IF NOT EXISTS payroll.pay_group_settings (
  tenant_id                   UUID PRIMARY KEY,
  allow_mid_month_effective   BOOLEAN     NOT NULL DEFAULT FALSE,
  updated_by                  UUID        NOT NULL,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE payroll.pay_group_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.pay_group_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.pay_group_settings;
CREATE POLICY tenant_isolation_policy ON payroll.pay_group_settings
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());
