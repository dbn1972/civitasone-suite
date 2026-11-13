-- 0166_finance_budget_control_coa_template.sql
-- Tenant-type profile switch (docs/design/TENANT-PROFILE-SWITCH.md), slice S2. Additive and idempotent.
--  1. gl.finance_settings.budget_control: mandatory (DEFAULT) | advisory | off. mandatory is the behaviour every tenant
--     has had since UAT T-PERIOD D-03 (no expenditure debit without a budget provision, GFR).
--  2. gl.finance_settings.coa_template: govt (DEFAULT) | commercial | nonprofit.
--  3. gl.finance_settings.profile_code: the tenant profile the settings were seeded from (informational).
--  4. gl.finance_settings.pending_accounting_basis / pending_basis_effective_from: an approved accounting-basis switch
--     waiting for the next 1 April (owner decision 3: approve ahead, apply at the FY rollover). NULL = nothing pending.
-- Backfill rule: every existing row, and every tenant without a row (an absent row reads as the defaults in
-- approvals/domain.ts), keeps budget_control = mandatory, coa_template = govt, profile_code = govt_dept, whatever its
-- edition. The column DEFAULTs are the backfill: ADD COLUMN with a constant default is a metadata-only change.
-- Rollback: ALTER TABLE gl.finance_settings DROP COLUMN budget_control, DROP COLUMN coa_template, DROP COLUMN profile_code,
-- DROP COLUMN pending_accounting_basis, DROP COLUMN pending_basis_effective_from (only while no tenant relies on a non-default value).

SET lock_timeout = '5s';

ALTER TABLE gl.finance_settings ADD COLUMN IF NOT EXISTS budget_control varchar(10) NOT NULL DEFAULT 'mandatory';
ALTER TABLE gl.finance_settings DROP CONSTRAINT IF EXISTS finance_settings_budget_control_check;
ALTER TABLE gl.finance_settings ADD CONSTRAINT finance_settings_budget_control_check
  CHECK (budget_control IN ('mandatory', 'advisory', 'off'));

ALTER TABLE gl.finance_settings ADD COLUMN IF NOT EXISTS coa_template varchar(12) NOT NULL DEFAULT 'govt';
ALTER TABLE gl.finance_settings DROP CONSTRAINT IF EXISTS finance_settings_coa_template_check;
ALTER TABLE gl.finance_settings ADD CONSTRAINT finance_settings_coa_template_check
  CHECK (coa_template IN ('govt', 'commercial', 'nonprofit'));

ALTER TABLE gl.finance_settings ADD COLUMN IF NOT EXISTS profile_code varchar(32) NOT NULL DEFAULT 'govt_dept';

ALTER TABLE gl.finance_settings ADD COLUMN IF NOT EXISTS pending_accounting_basis varchar(8);
ALTER TABLE gl.finance_settings ADD COLUMN IF NOT EXISTS pending_basis_effective_from date;
ALTER TABLE gl.finance_settings DROP CONSTRAINT IF EXISTS finance_settings_pending_basis_check;
ALTER TABLE gl.finance_settings ADD CONSTRAINT finance_settings_pending_basis_check CHECK (
  (pending_accounting_basis IS NULL AND pending_basis_effective_from IS NULL)
  OR (pending_accounting_basis IN ('cash', 'accrual') AND pending_basis_effective_from IS NOT NULL
      AND to_char(pending_basis_effective_from, 'MM-DD') = '04-01')
);
