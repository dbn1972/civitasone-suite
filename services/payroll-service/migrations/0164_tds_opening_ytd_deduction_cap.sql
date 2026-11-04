-- 0164_tds_opening_ytd_deduction_cap.sql
--
-- UAT T-PERIOD D-02b (2026-11-04, CRITICAL) and the PR #2459 review (ERP-head
-- decisions 2026-11-05). The March 2027 s.192 true-up deducted TDS Rs 2,70,847
-- from a gross of Rs 2,31,428 (net Rs 0), and the run was approved and paid.
--
-- 1. payroll.payroll_opening_ytd: per employee, per FY, the opening year-to-date
--    that the s.192 projection treats as AUTHORITATIVE:
--      source pre_go_live    salary paid and TDS deducted by THIS employer before
--                            the payroll went live here (months covered);
--      source prior_employer income and TDS of a previous employer in the FY
--                            (Form 12B, s.192(2)), with the employer name and TAN.
--    Maker-checker: entered_by records it, a different approved_by approves it;
--    only approved rows are used. One live (pending/approved) row per employee,
--    FY and source. Every change is audited by the consumer.
-- 2. payroll.payroll_settings:
--      payroll_go_live_date     TDS is presumed (flagged, acknowledged) only for
--                               in-service months BEFORE the later of this date
--                               and the employee first slip here, and only when
--                               no opening YTD exists; NULL = first slip only;
--      max_deduction_share_bps  ceiling on total deductions as a share of the
--                               wages earned: default 5000 (50%), Code on Wages
--                               2019 s.18(2) -- income-tax is an authorised
--                               deduction within the limit; 1000..10000;
--      deduction_cap_applies    default true. For regular government servants
--                               (FR/SR, CCS) the applicability of the wage law
--                               needs legal confirmation; when false only the
--                               protected-net floor and the approval
--                               acknowledgements apply.
-- 3. payroll.payroll_slips: what the approver must see -- presumed months,
--    TDS deducted above the liability, TDS not deducted because of the cap
--    (and whether it was the last FY / separation month, when payroll cannot
--    recover it), recoveries deferred by the cap.
--
-- Additive and idempotent; old code ignores the new columns and table.
--
-- Rollback:
--   DROP TABLE IF EXISTS payroll.payroll_opening_ytd;
--   ALTER TABLE payroll.payroll_settings DROP CONSTRAINT IF EXISTS payroll_settings_max_deduction_share_chk;
--   ALTER TABLE payroll.payroll_settings DROP COLUMN IF EXISTS max_deduction_share_bps,
--     DROP COLUMN IF EXISTS deduction_cap_applies, DROP COLUMN IF EXISTS payroll_go_live_date;
--   ALTER TABLE payroll.payroll_slips DROP COLUMN IF EXISTS tds_presumed_months, DROP COLUMN IF EXISTS tds_excess_minor,
--     DROP COLUMN IF EXISTS tds_shortfall_minor, DROP COLUMN IF EXISTS tds_shortfall_final, DROP COLUMN IF EXISTS recovery_deferred_minor;

SET lock_timeout = '5s';

ALTER TABLE payroll.payroll_settings
  ADD COLUMN IF NOT EXISTS max_deduction_share_bps INTEGER NOT NULL DEFAULT 5000,
  ADD COLUMN IF NOT EXISTS deduction_cap_applies   BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS payroll_go_live_date    DATE;

DO $$ BEGIN
  ALTER TABLE payroll.payroll_settings
    ADD CONSTRAINT payroll_settings_max_deduction_share_chk
    CHECK (max_deduction_share_bps BETWEEN 1000 AND 10000);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE payroll.payroll_slips
  ADD COLUMN IF NOT EXISTS tds_presumed_months     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tds_excess_minor        BIGINT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tds_shortfall_minor     BIGINT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tds_shortfall_final     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS recovery_deferred_minor BIGINT  NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS payroll.payroll_opening_ytd (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid         NOT NULL,
  employee_id         uuid         NOT NULL,
  fy                  char(7)      NOT NULL,
  source              varchar(16)  NOT NULL,
  months              integer      NOT NULL DEFAULT 0,
  salary_minor        bigint       NOT NULL DEFAULT 0,
  tds_minor           bigint       NOT NULL DEFAULT 0,
  prior_employer_name text,
  prior_employer_tan  varchar(10),
  note                text         NOT NULL,
  status              varchar(16)  NOT NULL DEFAULT 'pending',
  entered_by          uuid         NOT NULL,
  approved_by         uuid,
  decided_at          timestamptz,
  decision_note       text,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now(),
  version             integer      NOT NULL DEFAULT 1,
  CONSTRAINT payroll_opening_ytd_source_chk CHECK (source IN ('pre_go_live', 'prior_employer')),
  CONSTRAINT payroll_opening_ytd_status_chk CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT payroll_opening_ytd_fy_chk CHECK (fy ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT payroll_opening_ytd_amounts_chk CHECK (salary_minor >= 0 AND tds_minor >= 0 AND months BETWEEN 0 AND 11),
  CONSTRAINT payroll_opening_ytd_note_chk CHECK (length(btrim(note)) >= 10),
  CONSTRAINT payroll_opening_ytd_tan_chk CHECK (prior_employer_tan IS NULL OR prior_employer_tan ~ '^[A-Z]{4}[0-9]{5}[A-Z]$'),
  CONSTRAINT payroll_opening_ytd_decision_chk CHECK (
    (status = 'pending' AND approved_by IS NULL) OR (status <> 'pending' AND approved_by IS NOT NULL AND approved_by <> entered_by))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_payroll_opening_ytd_live
  ON payroll.payroll_opening_ytd (tenant_id, employee_id, fy, source) WHERE status <> 'rejected';
CREATE INDEX IF NOT EXISTS ix_payroll_opening_ytd_tenant_fy
  ON payroll.payroll_opening_ytd (tenant_id, fy, status);

ALTER TABLE payroll.payroll_opening_ytd ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_opening_ytd FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.payroll_opening_ytd;
CREATE POLICY tenant_isolation_policy ON payroll.payroll_opening_ytd
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());
