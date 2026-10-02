-- 0051: DSC passphrase must be stored sealed (P0 security)
--
-- Purpose:
--   payroll.dsc_config.passphrase holds the DSC keystore passphrase. The app
--   now seals it in the route handler (AES-256-GCM "enc:v2:<keyid>:" envelope,
--   src/shared/pii-crypto.ts via src/modules/dsc-config/secret.ts) and stores
--   ciphertext only. This CHECK makes the database refuse any NEW plaintext
--   value (defence in depth against a regression or a manual INSERT).
--
--   It is added NOT VALID so pre-existing legacy rows do not block the
--   migration (the AES key is app-held, so SQL cannot encrypt them). Seal
--   them with `node scripts/backfill-dsc-secrets.mjs`, then:
--     ALTER TABLE payroll.dsc_config VALIDATE CONSTRAINT dsc_config_passphrase_sealed_chk;
--
-- Rollback steps:
--   ALTER TABLE payroll.dsc_config DROP CONSTRAINT IF EXISTS dsc_config_passphrase_sealed_chk;
--
-- Affected services: payroll-service
-- Additive + idempotent.

SET lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dsc_config_passphrase_sealed_chk'
      AND conrelid = 'payroll.dsc_config'::regclass
  ) THEN
    ALTER TABLE payroll.dsc_config
      ADD CONSTRAINT dsc_config_passphrase_sealed_chk
      CHECK (passphrase LIKE 'enc:v1:%' OR passphrase LIKE 'enc:v2:%') NOT VALID;
  END IF;
END
$$;
