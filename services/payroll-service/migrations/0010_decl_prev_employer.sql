-- Scope 1/3: extend tax declaration with previous-employer income, income from
-- other sources, and perquisites (Sec 17(2)). All additive + idempotent.
-- Money in PAISE (bigint), consistent with the rest of the table.
ALTER TABLE payroll.payroll_tax_declarations
  ADD COLUMN IF NOT EXISTS prev_employer_salary_minor bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prev_employer_tds_minor    bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_sources_income_minor bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS perquisites_minor          bigint NOT NULL DEFAULT 0;
