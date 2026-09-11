-- 0020_contractor_pan_encryption.sql
-- SEC-011: Contractor PAN encryption at rest.
-- Widen works.contractors.pan from varchar(10) to text — ciphertext (AES-256-GCM
-- envelope, base64-encoded IV||tag||ct, prefixed "enc:v2:<keyid>:") runs to ~80+
-- chars and does not fit varchar(10). The application layer (encryptedText
-- custom type in shared/pii-crypto.ts) handles encrypt-on-write and
-- decrypt-on-read transparently. A separate backfill script (0021) encrypts
-- existing plaintext rows.
--
-- Rollback: ALTER TABLE works.contractors ALTER COLUMN pan TYPE varchar(10);
--           ALTER TABLE works.contractors DROP COLUMN IF EXISTS pii_encrypted_at;
--           DROP INDEX IF EXISTS works.idx_contractors_pii_backfill;
--           (Only safe to roll back the type change if no ciphertext has been
--           written yet — ciphertext will not fit back into varchar(10).)
--
-- Affected services: works-service
-- Depends on: 0015_contractors.sql

SET lock_timeout = '5s';

ALTER TABLE works.contractors
  ALTER COLUMN pan TYPE text;

-- Tracking column: NULL means the row's pan value (if any) is still plaintext.
-- Same pattern as procurement-service/migrations/0014_add_pii_encrypted_at.sql.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'works'
      AND table_name = 'contractors'
      AND column_name = 'pii_encrypted_at'
  ) THEN
    ALTER TABLE works.contractors
      ADD COLUMN pii_encrypted_at TIMESTAMPTZ;
  END IF;
END $$;

-- Partial index to speed up the backfill query (find unencrypted rows).
CREATE INDEX IF NOT EXISTS idx_contractors_pii_backfill
  ON works.contractors (tenant_id)
  WHERE pii_encrypted_at IS NULL;
