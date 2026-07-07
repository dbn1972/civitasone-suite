-- 0014_add_pii_encrypted_at.sql
-- Purpose: Add pii_encrypted_at timestamptz column to vendor.procurement_vendors
--          to track which rows have had their PII columns encrypted.
--          Rows where pii_encrypted_at IS NULL still contain plaintext PII.
--
-- Rollback: ALTER TABLE vendor.procurement_vendors DROP COLUMN IF EXISTS pii_encrypted_at;
--           DROP INDEX IF EXISTS vendor.idx_vendor_pii_backfill;
--
-- Affected services: procurement-service
-- Requirements: 2.2

SET lock_timeout = '5s';

-- Add the tracking column (nullable — NULL means not yet encrypted)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'vendor'
      AND table_name = 'procurement_vendors'
      AND column_name = 'pii_encrypted_at'
  ) THEN
    ALTER TABLE vendor.procurement_vendors
      ADD COLUMN pii_encrypted_at TIMESTAMPTZ;
  END IF;
END $$;

-- Partial index to speed up backfill queries (find unencrypted rows)
CREATE INDEX IF NOT EXISTS idx_vendor_pii_backfill
  ON vendor.procurement_vendors (tenant_id)
  WHERE pii_encrypted_at IS NULL;
