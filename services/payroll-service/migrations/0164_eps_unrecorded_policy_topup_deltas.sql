-- 0164_eps_unrecorded_policy_topup_deltas.sql
--
-- PR #2458 delta review (ERP-head decisions 2026-11-05).
--
-- statutory.payroll_pf.eps_basis   recorded | default: how the EPS eligibility
--   of the row was decided. "default" = no recorded fact (first EPF joining
--   date, joining wage, joint option, EPS membership): the member is treated
--   as an EPS member and the run raises EPS_ELIGIBILITY_UNRECORDED. NULL on
--   rows written before this migration or by callers that pass no facts.
-- payroll.payroll_settings.eps_unrecorded_policy  advisory (default) | block:
--   "block" refuses run approval (409 EPS_ELIGIBILITY_UNRECORDED) while any
--   EPF member of the run has no recorded EPS eligibility.
-- statutory.payroll_epf_admin_topups: the A/c 2 minimum top-up becomes
--   append-only per closed set of approved runs: run_set_key (the approved run
--   ids of the period), target_top_up_minor (the shortfall for that set) and
--   top_up_minor (the DELTA booked by that close, negative when admin accrued
--   by a later supplementary run reduced the shortfall). Unique per
--   (tenant, period, run_set_key): re-closing the same set is idempotent.
--
-- Additive and idempotent. Rows written by 0163 keep run_set_key '' and
-- target = top_up.

SET lock_timeout = '5s';

ALTER TABLE statutory.payroll_pf ADD COLUMN IF NOT EXISTS eps_basis varchar(16);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_pf_eps_basis_chk' AND conrelid = 'statutory.payroll_pf'::regclass) THEN
    ALTER TABLE statutory.payroll_pf ADD CONSTRAINT payroll_pf_eps_basis_chk CHECK (eps_basis IS NULL OR eps_basis IN ('recorded', 'default'));
  END IF;
END $$;

ALTER TABLE payroll.payroll_settings ADD COLUMN IF NOT EXISTS eps_unrecorded_policy varchar(16) NOT NULL DEFAULT 'advisory';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_settings_eps_unrecorded_policy_chk' AND conrelid = 'payroll.payroll_settings'::regclass) THEN
    ALTER TABLE payroll.payroll_settings ADD CONSTRAINT payroll_settings_eps_unrecorded_policy_chk CHECK (eps_unrecorded_policy IN ('advisory', 'block'));
  END IF;
END $$;

ALTER TABLE statutory.payroll_epf_admin_topups
  ADD COLUMN IF NOT EXISTS run_set_key         text   NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS target_top_up_minor bigint;
UPDATE statutory.payroll_epf_admin_topups SET target_top_up_minor = top_up_minor WHERE target_top_up_minor IS NULL;
ALTER TABLE statutory.payroll_epf_admin_topups ALTER COLUMN target_top_up_minor SET NOT NULL;
DROP INDEX IF EXISTS statutory.ux_payroll_epf_admin_topups_tenant_period;
CREATE UNIQUE INDEX IF NOT EXISTS ux_payroll_epf_admin_topups_tenant_period_runs ON statutory.payroll_epf_admin_topups (tenant_id, period, run_set_key);
CREATE INDEX IF NOT EXISTS ix_payroll_epf_admin_topups_tenant_period ON statutory.payroll_epf_admin_topups (tenant_id, period);
ALTER TABLE statutory.payroll_epf_admin_topups DROP CONSTRAINT IF EXISTS payroll_epf_admin_topups_nonneg_chk;
ALTER TABLE statutory.payroll_epf_admin_topups DROP CONSTRAINT IF EXISTS payroll_epf_admin_topups_values_chk;
ALTER TABLE statutory.payroll_epf_admin_topups ADD CONSTRAINT payroll_epf_admin_topups_values_chk
  CHECK (member_count >= 0 AND admin_accrued_minor >= 0 AND minimum_minor >= 0 AND target_top_up_minor >= 0);
