-- crm-service P1-2 (DPDP): field-level PII encryption at rest for contacts.
-- Email/phone move to app-layer AES-256-GCM ciphertext (longer than the old
-- varchar limits), so widen them to text. A deterministic keyed blind index
-- (email_idx) replaces the plaintext unique-email constraint and backs
-- bulk-import de-duplication. Additive + idempotent.

-- Widen PII columns to hold ciphertext (base64 of IV||tag||ct).
ALTER TABLE crm.contacts ALTER COLUMN email TYPE text;
ALTER TABLE crm.contacts ALTER COLUMN phone TYPE text;

-- Blind index over normalized email (keyed HMAC-SHA256, hex). Backfilled by
-- the application (scripts/backfill-pii.mjs) since the HMAC key is app-held.
ALTER TABLE crm.contacts ADD COLUMN IF NOT EXISTS email_idx text;

-- Swap the unique constraint from the (now-ciphertext) email column to the
-- deterministic blind index. The old constraint over ciphertext is useless
-- (random IV per row), so drop it and enforce uniqueness on email_idx instead.
ALTER TABLE crm.contacts DROP CONSTRAINT IF EXISTS uq_contacts_tenant_email;

CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_tenant_email_idx
  ON crm.contacts (tenant_id, email_idx)
  WHERE email_idx IS NOT NULL;
