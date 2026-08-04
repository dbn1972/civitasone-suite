-- Purpose: Add Indian business-identifier columns (GSTIN, PAN) plus PIN code to
--          crm.contacts, and GSTIN/PAN to crm.accounts, so duplicate detection can
--          match on business identity and DQ-003 format validation has real columns
--          to persist (DQ-001, DQ-003). GSTIN/PAN are business identifiers, NOT PII,
--          so they are stored in cleartext (unlike email/phone) and carry a
--          per-tenant normalized (upper-case) index for exact-match dedup.
-- Rollback: ALTER TABLE crm.contacts DROP COLUMN IF EXISTS gstin, DROP COLUMN IF EXISTS pan, DROP COLUMN IF EXISTS pincode;
--           ALTER TABLE crm.accounts DROP COLUMN IF EXISTS gstin, DROP COLUMN IF EXISTS pan;
-- Affected services: crm-service
-- Sequencing: additive — new nullable columns + partial indexes only. Safe to apply
--             before the code that writes them; existing rows read NULL.

SET lock_timeout = '5s';

ALTER TABLE crm.contacts ADD COLUMN IF NOT EXISTS gstin varchar(15);
ALTER TABLE crm.contacts ADD COLUMN IF NOT EXISTS pan varchar(10);
ALTER TABLE crm.contacts ADD COLUMN IF NOT EXISTS pincode varchar(6);

ALTER TABLE crm.accounts ADD COLUMN IF NOT EXISTS gstin varchar(15);
ALTER TABLE crm.accounts ADD COLUMN IF NOT EXISTS pan varchar(10);

-- Normalized (upper-case) partial indexes back exact GSTIN/PAN duplicate lookups
-- without forcing callers to store a canonical form.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_tenant_gstin
  ON crm.contacts(tenant_id, upper(gstin)) WHERE gstin IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_tenant_pan
  ON crm.contacts(tenant_id, upper(pan)) WHERE pan IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_accounts_tenant_gstin
  ON crm.accounts(tenant_id, upper(gstin)) WHERE gstin IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_accounts_tenant_pan
  ON crm.accounts(tenant_id, upper(pan)) WHERE pan IS NOT NULL;
