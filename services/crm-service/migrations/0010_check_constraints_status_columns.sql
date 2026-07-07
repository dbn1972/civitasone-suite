-- Purpose: Add CHECK constraints on all status/type columns to restrict values to defined state machine states
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: crm-service

SET lock_timeout = '5s';

-- ============================================================================
-- crm.deals.status
-- Valid states: active, won, lost, cancelled, deleted (deals/repo.ts softDelete
-- writes "deleted" — required for the soft-delete flow to persist)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE crm.deals
    ADD CONSTRAINT deals_status_check
    CHECK (status IN ('active', 'won', 'lost', 'cancelled', 'deleted'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- crm.activities.status
-- Valid states: open, completed, cancelled
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE crm.activities
    ADD CONSTRAINT activities_status_check
    CHECK (status IN ('open', 'completed', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- crm.activities.type
-- Valid values: call, meeting, email, task, note, complaint (zod enum in
-- validators.ts; drives branching in consumer.ts)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE crm.activities
    ADD CONSTRAINT activities_type_check
    CHECK (type IN ('call', 'meeting', 'email', 'task', 'note', 'complaint'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- crm.accounts.status
-- Valid states: active, inactive, churned
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE crm.accounts
    ADD CONSTRAINT accounts_status_check
    CHECK (status IN ('active', 'inactive', 'churned'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- crm.contacts.status
-- Valid states: active, inactive, deleted (contacts/repo.ts softDelete writes
-- "deleted" — required for the soft-delete flow to persist)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE crm.contacts
    ADD CONSTRAINT contacts_status_check
    CHECK (status IN ('active', 'inactive', 'deleted'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- crm.contacts.lead_status
-- Valid states: new, contacted, qualified, unqualified, converted
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE crm.contacts
    ADD CONSTRAINT contacts_lead_status_check
    CHECK (lead_status IN ('new', 'contacted', 'qualified', 'unqualified', 'converted'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE crm.deals VALIDATE CONSTRAINT deals_status_check;
ALTER TABLE crm.activities VALIDATE CONSTRAINT activities_status_check;
ALTER TABLE crm.activities VALIDATE CONSTRAINT activities_type_check;
ALTER TABLE crm.accounts VALIDATE CONSTRAINT accounts_status_check;
ALTER TABLE crm.contacts VALIDATE CONSTRAINT contacts_status_check;
ALTER TABLE crm.contacts VALIDATE CONSTRAINT contacts_lead_status_check;
