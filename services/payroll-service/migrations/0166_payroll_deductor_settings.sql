-- 0166_payroll_deductor_settings.sql
--
-- UAT P3 b19 D-15: the TDS deductor (employer) identity printed on Form 16,
-- Form 24Q / 26Q and Form 12BA becomes TENANT configuration instead of the
-- deployment-wide EMPLOYER_NAME / EMPLOYER_TAN / EMPLOYER_PAN env with
-- placeholder defaults ("<TAN — configure EMPLOYER_TAN>"), which went out on
-- the returns. Set through PUT /v1/payroll/settings/deductor (audited); the
-- returns refuse with 422 DEDUCTOR_NOT_CONFIGURED while it is missing/invalid.
--
-- ADDITIVE ONLY: three nullable columns on payroll.payroll_settings (NULL = not
-- configured; the env stays a fallback for a tenant with none of the three),
-- plus format CHECKs (TAN AAAA99999A, PAN AAAAA9999A, name 1..75 chars) so a
-- malformed value can never be stored. Old code ignores the columns. Safe to
-- apply before the new code; the new code needs it applied first. Idempotent.
-- FORCE ROW LEVEL SECURITY on payroll_settings is unchanged.
-- Rollback (only after the code is rolled back):
--   ALTER TABLE payroll.payroll_settings DROP CONSTRAINT IF EXISTS payroll_settings_deductor_tan_check,
--     DROP CONSTRAINT IF EXISTS payroll_settings_deductor_pan_check,
--     DROP CONSTRAINT IF EXISTS payroll_settings_deductor_name_check,
--     DROP COLUMN IF EXISTS deductor_name, DROP COLUMN IF EXISTS deductor_tan, DROP COLUMN IF EXISTS deductor_pan;

ALTER TABLE payroll.payroll_settings
  ADD COLUMN IF NOT EXISTS deductor_name text,
  ADD COLUMN IF NOT EXISTS deductor_tan  varchar(10),
  ADD COLUMN IF NOT EXISTS deductor_pan  varchar(10);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_settings_deductor_tan_check') THEN
    ALTER TABLE payroll.payroll_settings ADD CONSTRAINT payroll_settings_deductor_tan_check
      CHECK (deductor_tan IS NULL OR deductor_tan ~ '^[A-Z]{4}[0-9]{5}[A-Z]$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_settings_deductor_pan_check') THEN
    ALTER TABLE payroll.payroll_settings ADD CONSTRAINT payroll_settings_deductor_pan_check
      CHECK (deductor_pan IS NULL OR deductor_pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_settings_deductor_name_check') THEN
    ALTER TABLE payroll.payroll_settings ADD CONSTRAINT payroll_settings_deductor_name_check
      CHECK (deductor_name IS NULL OR char_length(btrim(deductor_name)) BETWEEN 1 AND 75);
  END IF;
END
$$;
