-- Purpose: Extend crm.contacts.lead_status CHECK constraint to include
--          'nurture', 'recycled', 'disqualified' statuses (LQ-004 lifecycle transitions).
-- Rollback: DROP CONSTRAINT contacts_lead_status_check_v2;
--           Re-add original constraint with only the old values.
-- Affected services: crm-service

SET lock_timeout = '5s';

-- Drop the old constraint (idempotent via IF EXISTS)
ALTER TABLE crm.contacts DROP CONSTRAINT IF EXISTS contacts_lead_status_check;

-- Add the expanded constraint (NOT VALID first, then validate — avoids full table lock)
DO $$ BEGIN
  ALTER TABLE crm.contacts
    ADD CONSTRAINT contacts_lead_status_check
    CHECK (lead_status IN ('new', 'contacted', 'qualified', 'unqualified', 'converted', 'nurture', 'recycled', 'disqualified'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE crm.contacts VALIDATE CONSTRAINT contacts_lead_status_check;
