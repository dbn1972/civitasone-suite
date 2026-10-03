-- 0073_bank_file_signing_setting.sql
-- GAP-PAYROLL-DISBURSEMENT-03: per-tenant bank-file signing policy.
--
-- payroll.payroll_settings gains ONE nullable jsonb column, bank_file_signing:
--   { "format": "pgp_detached" | "xml_dsig" | "pkcs7_detached" | "none",
--     "perBankOverrides": { "<4-letter bank code>": <format>, ... },
--     "encryptToBank": boolean,
--     "keyRef": "<opaque key reference string>" }
-- NULL means "no explicit setting": the application default applies, which is
-- signed (pgp_detached, encryptToBank false, keyRef "default"). Signing is
-- therefore ON for every tenant without a data backfill.
--
-- The column holds NO key material -- keyRef is a plain string resolved at
-- signing time by the SigningKeyProvider (dev key file / production keystore).
--
-- payroll_settings already has ENABLE + FORCE ROW LEVEL SECURITY and the
-- tenant_isolation_policy (migration 0036); both are re-asserted here so this
-- migration is self-contained and idempotent.
--
-- Rollback:
--   ALTER TABLE payroll.payroll_settings DROP CONSTRAINT IF EXISTS payroll_settings_bank_file_signing_chk;
--   ALTER TABLE payroll.payroll_settings DROP COLUMN IF EXISTS bank_file_signing;
SET lock_timeout = '5s';

ALTER TABLE payroll.payroll_settings
  ADD COLUMN IF NOT EXISTS bank_file_signing jsonb;

ALTER TABLE payroll.payroll_settings
  DROP CONSTRAINT IF EXISTS payroll_settings_bank_file_signing_chk;
ALTER TABLE payroll.payroll_settings
  ADD CONSTRAINT payroll_settings_bank_file_signing_chk CHECK (
    bank_file_signing IS NULL OR (
      -- COALESCE: a missing key makes the comparison NULL, which a CHECK
      -- would silently accept.
      COALESCE(jsonb_typeof(bank_file_signing) = 'object', false)
      AND COALESCE(bank_file_signing->>'format' IN ('pgp_detached', 'xml_dsig', 'pkcs7_detached', 'none'), false)
      AND COALESCE(jsonb_typeof(bank_file_signing->'encryptToBank') = 'boolean', false)
      AND COALESCE(jsonb_typeof(bank_file_signing->'keyRef') = 'string', false)
    )
  );

ALTER TABLE payroll.payroll_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_settings FORCE ROW LEVEL SECURITY;
