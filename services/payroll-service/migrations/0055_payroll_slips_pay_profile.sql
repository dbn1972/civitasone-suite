-- 0055_payroll_slips_pay_profile.sql
--
-- PAY-PROFILES (PR2): record on every slip WHICH pay computation produced it
-- and the inputs it used, so a slip is reproducible/auditable and downstream
-- consumers (F&F, ECR, reports) can branch on it:
--
--  * pay_profile      govt_scale | deputation_parent_scale |
--                     deputation_post_scale | consolidated_contract |
--                     ctc_contract. NULL on every slip computed before this
--                     migration (== govt_scale semantics).
--  * profile_snapshot jsonb: deputation id/option/direction/station, allowance
--                     mode + rule used, DA source/rate, HRA floor used,
--                     consolidated amount, engagement gratuity eligibility.
--  * pf_wage_minor    the EPF wage the slip's PF was computed on (before the
--                     wage ceiling), recorded for audit. Nothing reads it yet
--                     (ECR still derives Basic + DA from the components; the
--                     CTC profile in PR3 is where they can differ). NULL on
--                     legacy slips.
--
-- Nullable additive columns: no existing row or money column changes.

SET lock_timeout = '5s';

ALTER TABLE payroll.payroll_slips
  ADD COLUMN IF NOT EXISTS pay_profile      varchar(32),
  ADD COLUMN IF NOT EXISTS profile_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS pf_wage_minor    bigint;

DO $$ BEGIN
  ALTER TABLE payroll.payroll_slips ADD CONSTRAINT payroll_slips_pay_profile_chk
    CHECK (pay_profile IS NULL OR pay_profile IN
      ('govt_scale','deputation_parent_scale','deputation_post_scale','consolidated_contract','ctc_contract')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE payroll.payroll_slips ADD CONSTRAINT payroll_slips_pf_wage_nonneg_chk
    CHECK (pf_wage_minor IS NULL OR pf_wage_minor >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE payroll.payroll_slips VALIDATE CONSTRAINT payroll_slips_pay_profile_chk;
ALTER TABLE payroll.payroll_slips VALIDATE CONSTRAINT payroll_slips_pf_wage_nonneg_chk;
