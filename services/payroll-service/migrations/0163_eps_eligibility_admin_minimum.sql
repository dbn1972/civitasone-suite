-- 0163_eps_eligibility_admin_minimum.sql
--
-- PR #2458 review should-fix items (ERP-head decisions 2026-11-05).
--
-- SF1 statutory.payroll_pf.eps_wage_minor: the EPS wages the 8.33% fell on --
--     0 for a member who is not EPS-eligible (EPS 1995 para 6A: first EPF
--     membership on/after 01.09.2014 with wages above Rs 15,000, a para 26(6)
--     joint-option member, or a member aged 58+); then EPS = 0 and the whole
--     12% employer share goes to A/c 1. NULL on rows written before this
--     migration (the ECR then falls back to min(EPF wages, Rs 15,000)).
-- SF3 statutory.payroll_epf_admin_topups: one row per establishment (tenant)
--     per wage month, written when the EPF challan for the month is closed:
--     the shortfall of the per-member EPF admin charges against the Rs 500
--     A/c 2 minimum, max(0, minimum - admin accrued), accrued once to the GL.
--
-- Additive and idempotent. Rollback: DROP TABLE statutory.payroll_epf_admin_topups;
--   ALTER TABLE statutory.payroll_pf DROP COLUMN IF EXISTS eps_wage_minor;

SET lock_timeout = '5s';

ALTER TABLE statutory.payroll_pf ADD COLUMN IF NOT EXISTS eps_wage_minor bigint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_pf_eps_wage_nonneg_chk'
                   AND conrelid = 'statutory.payroll_pf'::regclass) THEN
    ALTER TABLE statutory.payroll_pf ADD CONSTRAINT payroll_pf_eps_wage_nonneg_chk CHECK (eps_wage_minor IS NULL OR eps_wage_minor >= 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS statutory.payroll_epf_admin_topups (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  period              char(7)     NOT NULL,
  member_count        integer     NOT NULL,
  admin_accrued_minor bigint      NOT NULL,
  minimum_minor       bigint      NOT NULL,
  top_up_minor        bigint      NOT NULL,
  journal_id          uuid,
  currency            char(3)     NOT NULL DEFAULT 'INR',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid        NOT NULL,
  updated_by          uuid        NOT NULL,
  version             integer     NOT NULL DEFAULT 1,
  CONSTRAINT payroll_epf_admin_topups_nonneg_chk CHECK (member_count >= 0 AND admin_accrued_minor >= 0 AND minimum_minor >= 0 AND top_up_minor >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_payroll_epf_admin_topups_tenant_period ON statutory.payroll_epf_admin_topups (tenant_id, period);
ALTER TABLE statutory.payroll_epf_admin_topups ENABLE ROW LEVEL SECURITY;
ALTER TABLE statutory.payroll_epf_admin_topups FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON statutory.payroll_epf_admin_topups;
CREATE POLICY tenant_isolation_policy ON statutory.payroll_epf_admin_topups
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());
