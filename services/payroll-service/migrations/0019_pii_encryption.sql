-- Migration: Convert PII columns to encrypted text
-- The application layer now uses encryptedText (AES-256-GCM) for at-rest encryption.
-- This migration widens deductee_pan from varchar(10) to text to accommodate ciphertext.
-- Existing plaintext values are handled by the decrypt fallback (pass-through on non-prefixed values).
-- A backfill job will encrypt existing rows in-place (separate task).

-- Widen deductee_pan to text (was varchar(10), ciphertext is ~80+ chars)
ALTER TABLE statutory.payroll_tds_nonsalary
  ALTER COLUMN deductee_pan TYPE text;

-- Drop the NOT NULL + DEFAULT constraint since encrypted values are longer and nullable during backfill
ALTER TABLE statutory.payroll_tds_nonsalary
  ALTER COLUMN deductee_pan DROP DEFAULT;
