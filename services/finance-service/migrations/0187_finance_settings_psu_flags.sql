-- 0187_finance_settings_psu_flags.sql
-- PSU v1 slice B (docs: ~/orch-logs/segments/PSU-GAP-ANALYSIS.md, decision D5). Additive and idempotent.
--  gl.finance_settings gains two flags that mark a public-sector undertaking WITHOUT a new entity_type (a PSU is a company):
--    govt_owned     boolean NOT NULL DEFAULT false   -- constant default: metadata-only on PG 11+, no table rewrite
--    audit_profile  text    NOT NULL DEFAULT 'standard', CHECK in ('standard','cag_caro')
--  Nothing reads these columns yet: every existing row reads govt_owned = false / audit_profile = 'standard'
--  (the defaults ARE the backfill), so govt and MSME behaviour is byte-identical.
--  Changed only through the maker-checker route (approvals/), like accounting_basis / entity_type; set at onboard only for a
--  tenant whose profile (tenant-profile catalogue) carries them. accounting_standard is owned by PSU slice A (its own migration).
-- Rollback: ALTER TABLE gl.finance_settings DROP CONSTRAINT IF EXISTS finance_settings_audit_profile_valid,
--             DROP COLUMN IF EXISTS govt_owned, DROP COLUMN IF EXISTS audit_profile;
--           (only while no tenant relies on them).

SET lock_timeout = '5s';

ALTER TABLE gl.finance_settings ADD COLUMN IF NOT EXISTS govt_owned boolean NOT NULL DEFAULT false;
ALTER TABLE gl.finance_settings ADD COLUMN IF NOT EXISTS audit_profile text NOT NULL DEFAULT 'standard';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_settings_audit_profile_valid' AND conrelid = 'gl.finance_settings'::regclass) THEN
    ALTER TABLE gl.finance_settings ADD CONSTRAINT finance_settings_audit_profile_valid
      CHECK (audit_profile IN ('standard', 'cag_caro')) NOT VALID;
  END IF;
END $$;

ALTER TABLE gl.finance_settings VALIDATE CONSTRAINT finance_settings_audit_profile_valid;
