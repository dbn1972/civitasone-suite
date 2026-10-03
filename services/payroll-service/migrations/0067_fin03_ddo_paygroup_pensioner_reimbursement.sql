-- 0067_fin03_ddo_paygroup_pensioner_reimbursement.sql
--
-- fin-payroll-03 gap batch. Idempotent (re-runnable).
--
--  * GAP-PAYROLL-DDOS-03        payroll_ddos.is_active (+ who/when deactivated)
--  * GAP-PAYROLL-PAY-GROUPS-01  pay_groups weekday / last-day / bi-weekly parity
--  * GAP-PAYROLL-PENSIONERS-03  payroll_pensioners status stopped|deceased + audit columns
--  * GAP-PAYROLL-REIMBURSEMENTS-03 payroll_reimbursements.attachment_keys (private S3 keys)
--  * GAP-PAYROLL-REGISTER-04    payroll_register.total_gpf_minor / total_nps_minor

-- DDOs
ALTER TABLE payroll.payroll_ddos ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE payroll.payroll_ddos ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
ALTER TABLE payroll.payroll_ddos ADD COLUMN IF NOT EXISTS deactivated_by UUID;

-- Pay groups
-- pay_weekday: ISO weekday 1 (Mon) .. 7 (Sun); required by weekly / bi_weekly.
-- pay_last_day: monthly groups paid on the last calendar day of the month.
-- pay_week_parity: bi_weekly only; 1 = odd ISO weeks, 0 = even ISO weeks.
ALTER TABLE payroll.pay_groups ADD COLUMN IF NOT EXISTS pay_weekday SMALLINT;
ALTER TABLE payroll.pay_groups ADD COLUMN IF NOT EXISTS pay_last_day BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE payroll.pay_groups ADD COLUMN IF NOT EXISTS pay_week_parity SMALLINT;
DO $$ BEGIN
  ALTER TABLE payroll.pay_groups ADD CONSTRAINT pay_groups_pay_weekday_check
    CHECK (pay_weekday IS NULL OR pay_weekday BETWEEN 1 AND 7);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE payroll.pay_groups ADD CONSTRAINT pay_groups_pay_week_parity_check
    CHECK (pay_week_parity IS NULL OR pay_week_parity IN (0, 1));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Pensioners: stop / deceased
ALTER TABLE payroll.payroll_pensioners ADD COLUMN IF NOT EXISTS status_reason TEXT;
ALTER TABLE payroll.payroll_pensioners ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;
ALTER TABLE payroll.payroll_pensioners ADD COLUMN IF NOT EXISTS status_changed_by UUID;
ALTER TABLE payroll.payroll_pensioners ADD COLUMN IF NOT EXISTS date_of_death DATE;
ALTER TABLE payroll.payroll_pensioners DROP CONSTRAINT IF EXISTS payroll_pensioners_status_check;
ALTER TABLE payroll.payroll_pensioners ADD CONSTRAINT payroll_pensioners_status_check
  CHECK (status IN ('active', 'stopped', 'deceased'));

-- Reimbursements: receipt attachments. Object-store keys only (never file
-- bytes), under payroll/<tenant>/reimbursements/ in the private bucket; reads
-- go through a short-lived presigned URL from an audited, role-gated endpoint.
ALTER TABLE payroll.payroll_reimbursements ADD COLUMN IF NOT EXISTS attachment_keys TEXT[] NOT NULL DEFAULT '{}';

-- Register: GPF / NPS columns. DEFAULT 0 -- rows written before this
-- migration read 0 until the run's register is rebuilt (backfill script).
ALTER TABLE payroll.payroll_register ADD COLUMN IF NOT EXISTS total_gpf_minor BIGINT NOT NULL DEFAULT 0;
ALTER TABLE payroll.payroll_register ADD COLUMN IF NOT EXISTS total_nps_minor BIGINT NOT NULL DEFAULT 0;
