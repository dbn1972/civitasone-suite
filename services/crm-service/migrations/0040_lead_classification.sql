-- Purpose: LQ-003 — add lead classification columns to crm.contacts so a lead can
--          be classified/reported by temperature, priority, segment, product,
--          region and expected deal value. All nullable and additive: a tenant
--          that never sets them keeps today's behaviour, and existing rows are
--          left NULL (no backfill).
-- Rollback: ALTER TABLE crm.contacts
--             DROP COLUMN IF EXISTS temperature, DROP COLUMN IF EXISTS priority,
--             DROP COLUMN IF EXISTS segment, DROP COLUMN IF EXISTS product,
--             DROP COLUMN IF EXISTS region, DROP COLUMN IF EXISTS expected_value_minor;
-- Affected services: crm-service
-- Sequencing: additive — new nullable columns only, safe to apply before the code
--             that reads/writes them.

SET lock_timeout = '5s';

ALTER TABLE crm.contacts
  ADD COLUMN IF NOT EXISTS temperature varchar(8)
    CONSTRAINT contacts_temperature_check CHECK (temperature IN ('hot', 'warm', 'cold')),
  ADD COLUMN IF NOT EXISTS priority varchar(8)
    CONSTRAINT contacts_priority_check CHECK (priority IN ('high', 'medium', 'low')),
  ADD COLUMN IF NOT EXISTS segment varchar(64),
  ADD COLUMN IF NOT EXISTS product varchar(120),
  ADD COLUMN IF NOT EXISTS region varchar(64),
  -- Expected deal value in the minor unit (paise). Money is never a float; stored
  -- as a bigint of paise like every other money column in the platform. NULL = not set.
  ADD COLUMN IF NOT EXISTS expected_value_minor bigint
    CONSTRAINT contacts_expected_value_minor_check CHECK (expected_value_minor IS NULL OR expected_value_minor >= 0);

-- Partial indexes to keep the classification filters (LQ-003 reporting) cheap on
-- large tenants; only rows that actually carry a value are indexed.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_tenant_temperature
  ON crm.contacts (tenant_id, temperature) WHERE temperature IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_tenant_priority
  ON crm.contacts (tenant_id, priority) WHERE priority IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_tenant_segment
  ON crm.contacts (tenant_id, segment) WHERE segment IS NOT NULL;
