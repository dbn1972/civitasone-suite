-- 0186_finance_settings_accounting_standard.sql
-- PSU v1 slice A. Per-tenant accounting framework for the commercial (Schedule III) statements. Additive and idempotent.
--  gl.finance_settings gains accounting_standard text NULL, CHECK in ('as', 'ind_as') or NULL.
--  NULL = "not chosen": the commercial statements fall back to the deployment default (env FINANCE_COMMERCIAL_ACCOUNTING_STANDARD,
--  default AS), so every existing tenant renders exactly as before. v1 only RECORDS the framework (drives markers.framework);
--  no Ind AS statement behaviour is built.
-- Backfill rule: every existing row reads NULL (the default IS the backfill); the CHECK holds for every existing row; govt untouched.
-- Changed only through the maker-checker route (approvals/), like accounting_basis / entity_type.
-- Rollback: ALTER TABLE gl.finance_settings DROP CONSTRAINT IF EXISTS finance_settings_accounting_standard_valid,
--             DROP COLUMN IF EXISTS accounting_standard;
SET lock_timeout = '5s';

ALTER TABLE gl.finance_settings ADD COLUMN IF NOT EXISTS accounting_standard text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_settings_accounting_standard_valid' AND conrelid = 'gl.finance_settings'::regclass) THEN
    ALTER TABLE gl.finance_settings ADD CONSTRAINT finance_settings_accounting_standard_valid
      CHECK (accounting_standard IS NULL OR accounting_standard IN ('as', 'ind_as')) NOT VALID;
  END IF;
END $$;

ALTER TABLE gl.finance_settings VALIDATE CONSTRAINT finance_settings_accounting_standard_valid;
