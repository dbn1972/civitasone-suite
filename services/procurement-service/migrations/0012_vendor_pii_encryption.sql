-- 0012_vendor_pii_encryption.sql
-- H4: Vendor PII encryption at rest.
-- Widen PAN/email/phone/bank_account/IFSC columns to text (ciphertext is ~80+ chars).
-- The application layer (encryptedText custom type) handles encrypt-on-write and
-- decrypt-on-read. A separate backfill script encrypts existing plaintext rows.
-- Additive + idempotent only — no data loss, no DROP columns.

-- Already text() so no type change needed — just document that these columns
-- now store ciphertext. The app-layer customType handles transparently.
-- Nothing to ALTER since columns were already defined as text().

-- Add a marker column to track backfill progress (idempotent).
ALTER TABLE vendor.procurement_vendors
  ADD COLUMN IF NOT EXISTS pii_encrypted_at TIMESTAMPTZ;

-- Index to speed up the backfill query (find unencrypted rows).
CREATE INDEX IF NOT EXISTS idx_vendor_pii_backfill
  ON vendor.procurement_vendors (tenant_id)
  WHERE pii_encrypted_at IS NULL;
