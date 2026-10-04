-- 0083_payroll_runs_pay_group.sql
--
-- GAP-PAYROLL-PAY-GROUPS-03: a regular run may be scoped to one pay group
-- (NULL = legacy whole-tenant / DDO run, behaviour unchanged). A DDO now has
-- one bill per pay group, so the per-period uniqueness of regular runs gains
-- the pay group: one non-failed regular run per tenant + month + DDO + pay
-- group. For runs without a pay group the key is identical to before.
-- Idempotent.

ALTER TABLE payroll.payroll_runs ADD COLUMN IF NOT EXISTS pay_group_id UUID REFERENCES payroll.pay_groups (id);
CREATE INDEX IF NOT EXISTS ix_payroll_runs_pay_group ON payroll.payroll_runs (tenant_id, pay_group_id) WHERE pay_group_id IS NOT NULL;

DROP INDEX IF EXISTS payroll.ux_payroll_runs_tenant_month_ddo_regular;
CREATE UNIQUE INDEX IF NOT EXISTS ux_payroll_runs_tenant_month_scope_regular
  ON payroll.payroll_runs (tenant_id, month, COALESCE(ddo_code, '__ALL__'),
                           COALESCE(pay_group_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status <> 'failed' AND status <> 'cancelled' AND run_type = 'regular';
