-- 0167_hrms_deputation_pay_terms.sql
--
-- PAY-PROFILES (PR1): the pay terms of a deputation order, so payroll can pay
-- a deputationist under Option A (parent pay scale + deputation (duty)
-- allowance) or Option B (pay scale of the deputation post, no allowance).
--
--  * direction: 'out' (this tenant's employee deputed to a borrowing
--    department -- the only case the table modelled before) or 'in' (an
--    employee of another organisation serving here on deputation). A
--    deputed-IN employee has an EXTERNAL parent, so parent_department_id
--    becomes nullable, re-required for 'out' by a CHECK.
--  * allowance_mode: 'auto' = computed from the tenant's deputation-
--    allowance rule (% of basic, capped, by station type) once that rule is
--    configured in payroll, else the fixed amount below; 'fixed' = the
--    per-employee amount from the deputation order (deputation_allowance_
--    minor) always wins. Existing rows that carry an HR-entered amount are
--    back-filled to 'fixed' so their recorded amount is preserved.
--  * da_source: 'central' (default) or 'parent' -- the latter for a State
--    Government deputationist whose order keeps parent-State DA; requires
--    parent_da_rate_bps.
--  * foreign_service: flag-and-report only (no contribution posting).
--
-- Rows only influence pay once an approved pay profile (0166) points at them,
-- so this migration alone changes no payslip. Additive + idempotent.

SET lock_timeout = '5s';

DO $$
DECLARE had_mode boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'lifecycle' AND table_name = 'hrms_deputations' AND column_name = 'allowance_mode'
  ) INTO had_mode;

  ALTER TABLE lifecycle.hrms_deputations
    ADD COLUMN IF NOT EXISTS direction             varchar(4)   NOT NULL DEFAULT 'out',
    ADD COLUMN IF NOT EXISTS pay_option            varchar(16),
    ADD COLUMN IF NOT EXISTS station_type          varchar(8),
    ADD COLUMN IF NOT EXISTS parent_organisation   varchar(200),
    ADD COLUMN IF NOT EXISTS parent_pay_level      smallint,
    ADD COLUMN IF NOT EXISTS parent_basic_minor    bigint,
    ADD COLUMN IF NOT EXISTS post_pay_level        smallint,
    ADD COLUMN IF NOT EXISTS post_basic_minor      bigint,
    ADD COLUMN IF NOT EXISTS allowance_mode        varchar(8)   NOT NULL DEFAULT 'auto',
    ADD COLUMN IF NOT EXISTS foreign_service       boolean      NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS parent_pension_scheme varchar(8),
    ADD COLUMN IF NOT EXISTS da_source             varchar(8)   NOT NULL DEFAULT 'central',
    ADD COLUMN IF NOT EXISTS parent_da_rate_bps    integer;

  -- One-time back-fill, only on the run that created the column: preserve an
  -- HR-entered allowance as a per-employee override.
  IF NOT had_mode THEN
    UPDATE lifecycle.hrms_deputations SET allowance_mode = 'fixed' WHERE deputation_allowance_minor > 0;
  END IF;
END $$;

ALTER TABLE lifecycle.hrms_deputations ALTER COLUMN parent_department_id DROP NOT NULL;

DO $$ BEGIN
  ALTER TABLE lifecycle.hrms_deputations ADD CONSTRAINT hrms_deputations_parent_dept_chk
    CHECK (direction = 'in' OR parent_department_id IS NOT NULL) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE lifecycle.hrms_deputations ADD CONSTRAINT hrms_deputations_direction_chk
    CHECK (direction IN ('out','in')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE lifecycle.hrms_deputations ADD CONSTRAINT hrms_deputations_pay_option_chk
    CHECK (pay_option IS NULL OR pay_option IN ('parent_scale','post_scale')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE lifecycle.hrms_deputations ADD CONSTRAINT hrms_deputations_station_type_chk
    CHECK (station_type IS NULL OR station_type IN ('same','other')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE lifecycle.hrms_deputations ADD CONSTRAINT hrms_deputations_allowance_mode_chk
    CHECK (allowance_mode IN ('auto','fixed')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE lifecycle.hrms_deputations ADD CONSTRAINT hrms_deputations_parent_scheme_chk
    CHECK (parent_pension_scheme IS NULL OR parent_pension_scheme IN ('GPF','NPS','EPF')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE lifecycle.hrms_deputations ADD CONSTRAINT hrms_deputations_da_source_chk
    CHECK (da_source IN ('central','parent') AND (da_source = 'central' OR parent_da_rate_bps IS NOT NULL)) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE lifecycle.hrms_deputations ADD CONSTRAINT hrms_deputations_pay_amounts_chk
    CHECK ((parent_basic_minor IS NULL OR parent_basic_minor >= 0)
       AND (post_basic_minor IS NULL OR post_basic_minor >= 0)
       AND (parent_da_rate_bps IS NULL OR parent_da_rate_bps BETWEEN 0 AND 100000)
       AND (parent_pay_level IS NULL OR parent_pay_level BETWEEN 1 AND 18)
       AND (post_pay_level IS NULL OR post_pay_level BETWEEN 1 AND 18)) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE lifecycle.hrms_deputations VALIDATE CONSTRAINT hrms_deputations_parent_dept_chk;
ALTER TABLE lifecycle.hrms_deputations VALIDATE CONSTRAINT hrms_deputations_direction_chk;
ALTER TABLE lifecycle.hrms_deputations VALIDATE CONSTRAINT hrms_deputations_pay_option_chk;
ALTER TABLE lifecycle.hrms_deputations VALIDATE CONSTRAINT hrms_deputations_station_type_chk;
ALTER TABLE lifecycle.hrms_deputations VALIDATE CONSTRAINT hrms_deputations_allowance_mode_chk;
ALTER TABLE lifecycle.hrms_deputations VALIDATE CONSTRAINT hrms_deputations_parent_scheme_chk;
ALTER TABLE lifecycle.hrms_deputations VALIDATE CONSTRAINT hrms_deputations_da_source_chk;
ALTER TABLE lifecycle.hrms_deputations VALIDATE CONSTRAINT hrms_deputations_pay_amounts_chk;
