-- 0074_disbursement_file_signature.sql
-- GAP-PAYROLL-DISBURSEMENT-03: the signature of an issued bank file is stored
-- on the issuance record, next to a sha256 of the exact bytes that were signed.
--
--   signature_format           which scheme signed it (NULL = a file issued
--                              before signing existed; treated as unsigned)
--   signature                  the detached signature: ASCII-armoured text for
--                              pgp_detached, base64 of the DER for
--                              pkcs7_detached. NULL for xml_dsig (the signature
--                              is enveloped inside the XML file itself) and
--                              for 'none'.
--   file_sha256                hex sha256 of the signed bytes (the file as
--                              rendered, BEFORE any encrypt-to-bank wrapping)
--   signed_at / signing_key_fingerprint   when, and with which key
--   encrypted_to_bank          the delivered file was OpenPGP-encrypted to the
--                              bank's public key (signature is over the
--                              plaintext file)
--
-- The file itself is NOT stored; only its name, hash and signature are.
-- The table already has ENABLE + FORCE RLS and tenant_isolation_policy
-- (migration 0053); re-asserted so this migration is self-contained.
--
-- Rollback:
--   ALTER TABLE payroll.disbursement_file_issuances
--     DROP CONSTRAINT IF EXISTS disbursement_file_issuances_signature_chk,
--     DROP COLUMN IF EXISTS signature_format, DROP COLUMN IF EXISTS signature,
--     DROP COLUMN IF EXISTS file_sha256, DROP COLUMN IF EXISTS signed_at,
--     DROP COLUMN IF EXISTS signing_key_fingerprint, DROP COLUMN IF EXISTS encrypted_to_bank;
SET lock_timeout = '5s';

ALTER TABLE payroll.disbursement_file_issuances
  ADD COLUMN IF NOT EXISTS signature_format          varchar(16),
  ADD COLUMN IF NOT EXISTS signature                 text,
  ADD COLUMN IF NOT EXISTS file_sha256               char(64),
  ADD COLUMN IF NOT EXISTS signed_at                 timestamptz,
  ADD COLUMN IF NOT EXISTS signing_key_fingerprint   varchar(128),
  ADD COLUMN IF NOT EXISTS encrypted_to_bank         boolean NOT NULL DEFAULT false;

ALTER TABLE payroll.disbursement_file_issuances
  DROP CONSTRAINT IF EXISTS disbursement_file_issuances_signature_chk;
ALTER TABLE payroll.disbursement_file_issuances
  ADD CONSTRAINT disbursement_file_issuances_signature_chk CHECK (
    (signature_format IS NULL
       OR signature_format IN ('pgp_detached', 'xml_dsig', 'pkcs7_detached', 'none'))
    -- a detached scheme always carries its signature, an embedded/none scheme never does
    AND ((signature_format IN ('pgp_detached', 'pkcs7_detached')) = (signature IS NOT NULL))
    -- a signed file always records what was signed, when, and with which key
    AND (signature_format IS NULL OR signature_format = 'none'
         OR (file_sha256 IS NOT NULL AND signed_at IS NOT NULL AND signing_key_fingerprint IS NOT NULL))
    AND (file_sha256 IS NULL OR file_sha256 ~ '^[0-9a-f]{64}$')
  );

ALTER TABLE payroll.disbursement_file_issuances ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.disbursement_file_issuances FORCE ROW LEVEL SECURITY;
