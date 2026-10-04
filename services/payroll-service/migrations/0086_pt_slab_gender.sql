-- 0086_pt_slab_gender.sql
--
-- Gender-specific professional-tax slabs. Some States' PT Acts set a different
-- (lower, or nil) slab for women (e.g. the Maharashtra Tax on Professions,
-- Trades, Callings and Employments Act, 1975, Schedule I) -- VERIFY every
-- State's rule; NOTHING is seeded here and every existing slab stays 'all'.
--
--  * payroll_professional_tax.applies_to_gender: 'all' (default) | 'female' | 'male'.
--    The run engine prefers a slab of the employee's own gender that holds the
--    income, else an 'all' slab; an employee with no recorded gender gets 'all'
--    slabs only.
--  * Slab ranges must not overlap WITHIN a gender group, so the unique key now
--    includes applies_to_gender. New key first (no window without uniqueness),
--    then the old one (0076) is dropped.
-- Idempotent. The 0077 immutability triggers fire on UPDATE/DELETE only; this
-- ADD COLUMN ... DEFAULT rewrites no row through them.

SET lock_timeout = '5s';

ALTER TABLE payroll.payroll_professional_tax
  ADD COLUMN IF NOT EXISTS applies_to_gender VARCHAR(8) NOT NULL DEFAULT 'all';

DO $$ BEGIN
  ALTER TABLE payroll.payroll_professional_tax ADD CONSTRAINT payroll_pt_applies_to_gender_chk
    CHECK (applies_to_gender IN ('all', 'female', 'male'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_pt_tenant_state_eff_gender_slab
  ON payroll.payroll_professional_tax (tenant_id, state_code, effective_from, applies_to_gender, slab_from_minor);
DROP INDEX IF EXISTS payroll.ux_pt_tenant_state_eff_slab;
