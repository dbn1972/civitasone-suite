-- 0162_epf_edli_admin_charges.sql
--
-- UAT b18 (EPF for contract staff, 2026-11-05) D5 / D6.
--
-- statutory.statutory_config: employer-only EPFO charges, effective-dated and
-- tenant-overridable like every other PF/ESI rate in this table (DOM-008):
--   edli_rate_bps        EDLI contribution, A/c 21 (0.5% = 50 bps)
--   edli_wage_cap_minor  EDLI wage ceiling, paise (Rs 15,000 -> max Rs 75/member)
--   epf_admin_rate_bps   EPF administrative charges, A/c 2 (0.5% = 50 bps)
--   epf_admin_min_minor  A/c 2 statutory minimum per establishment per wage
--                        month, paise (Rs 500)
-- Defaults equal DEFAULT_STATUTORY_CONFIG in modules/payroll/domain.ts, so
-- existing rows resolve to exactly the values the code assumes.
--
-- statutory.payroll_pf: the figures written with each EPF member row
--   epf_wage_minor      EPF wage actually used: min(Basic + DA, PF ceiling)
--   edli_wage_minor     EDLI wages: min(Basic + DA, EDLI ceiling)
--   edli_contrib_minor  employer EDLI (A/c 21)
--   epf_admin_minor     employer admin charge for the member (A/c 2), before
--                       the establishment minimum (applied on the summary)
-- NULL / 0 on rows written before this migration: a past month is NOT
-- reconstructed; the ECR falls back to min(Basic + DA, Rs 15,000) for them.
--
-- statutory.payroll_ups_pool (ERP-head decision 2026-11-05 on PR #2458): the
--   Government's 8.5% UPS POOL corpus contribution (UPS notification of 24 Jan
--   2025: 10% to the individual corpus + 8.5% to the pool corpus) is its own
--   statutory row, separate from the individual 10% on payroll_nps, because it
--   is not credited to the employee's individual account. One row per UPS slip.
--
-- Additive and idempotent: no existing column, constraint, policy or row is
-- changed; old code keeps working on it. Both tables keep their FORCE RLS
-- tenant policies.
--
-- Rollback:
--   ALTER TABLE statutory.payroll_pf DROP COLUMN IF EXISTS epf_wage_minor,
--     DROP COLUMN IF EXISTS edli_wage_minor, DROP COLUMN IF EXISTS edli_contrib_minor,
--     DROP COLUMN IF EXISTS epf_admin_minor;
--   DROP TABLE IF EXISTS statutory.payroll_ups_pool;
--   ALTER TABLE statutory.statutory_config DROP COLUMN IF EXISTS edli_rate_bps,
--     DROP COLUMN IF EXISTS edli_wage_cap_minor, DROP COLUMN IF EXISTS epf_admin_rate_bps,
--     DROP COLUMN IF EXISTS epf_admin_min_minor;

SET lock_timeout = '5s';

ALTER TABLE statutory.statutory_config
  ADD COLUMN IF NOT EXISTS edli_rate_bps       integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS edli_wage_cap_minor bigint  NOT NULL DEFAULT 1500000,
  ADD COLUMN IF NOT EXISTS epf_admin_rate_bps  integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS epf_admin_min_minor bigint  NOT NULL DEFAULT 50000;

ALTER TABLE statutory.payroll_pf
  ADD COLUMN IF NOT EXISTS epf_wage_minor     bigint,
  ADD COLUMN IF NOT EXISTS edli_wage_minor    bigint,
  ADD COLUMN IF NOT EXISTS edli_contrib_minor bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS epf_admin_minor    bigint NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'statutory_config_edli_admin_nonneg_chk'
                   AND conrelid = 'statutory.statutory_config'::regclass) THEN
    ALTER TABLE statutory.statutory_config ADD CONSTRAINT statutory_config_edli_admin_nonneg_chk
      CHECK (edli_rate_bps >= 0 AND edli_wage_cap_minor >= 0 AND epf_admin_rate_bps >= 0 AND epf_admin_min_minor >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_pf_edli_admin_nonneg_chk'
                   AND conrelid = 'statutory.payroll_pf'::regclass) THEN
    ALTER TABLE statutory.payroll_pf ADD CONSTRAINT payroll_pf_edli_admin_nonneg_chk
      CHECK ((epf_wage_minor IS NULL OR epf_wage_minor >= 0) AND (edli_wage_minor IS NULL OR edli_wage_minor >= 0)
             AND edli_contrib_minor >= 0 AND epf_admin_minor >= 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS statutory.payroll_ups_pool (
  id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid         NOT NULL,
  slip_id            uuid         NOT NULL,
  employee_id        uuid         NOT NULL,
  run_id             uuid         NOT NULL,
  pension_base_minor bigint       NOT NULL,
  contrib_pct        numeric(5,2) NOT NULL DEFAULT 8.5,
  contrib_minor      bigint       NOT NULL,
  currency           char(3)      NOT NULL DEFAULT 'INR',
  period             char(7)      NOT NULL,
  created_at         timestamptz  NOT NULL DEFAULT now(),
  updated_at         timestamptz  NOT NULL DEFAULT now(),
  created_by         uuid         NOT NULL,
  updated_by         uuid         NOT NULL,
  version            integer      NOT NULL DEFAULT 1,
  CONSTRAINT payroll_ups_pool_nonneg_chk CHECK (pension_base_minor >= 0 AND contrib_minor >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_payroll_ups_pool_slip ON statutory.payroll_ups_pool (tenant_id, slip_id);
CREATE INDEX IF NOT EXISTS ix_payroll_ups_pool_tenant_run ON statutory.payroll_ups_pool (tenant_id, run_id);
CREATE INDEX IF NOT EXISTS ix_payroll_ups_pool_tenant_period ON statutory.payroll_ups_pool (tenant_id, period);
ALTER TABLE statutory.payroll_ups_pool ENABLE ROW LEVEL SECURITY;
ALTER TABLE statutory.payroll_ups_pool FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON statutory.payroll_ups_pool;
CREATE POLICY tenant_isolation_policy ON statutory.payroll_ups_pool
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());
