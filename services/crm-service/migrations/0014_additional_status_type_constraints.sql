-- Purpose: Add CHECK constraints on remaining status/type columns lacking them (follow-up to 0010_check_constraints_status_columns.sql)
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: crm-service

SET lock_timeout = '5s';

-- ============================================================================
-- crm.deals.stage
-- Valid states: Lead, Proposal, Negotiation, Won, Lost
-- (validators.ts dealStage z.enum(["Lead","Proposal","Negotiation","Won","Lost"]);
-- consumer.ts updateStage persists the validated value directly)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE crm.deals
    ADD CONSTRAINT deals_stage_check
    CHECK (stage IN ('Lead', 'Proposal', 'Negotiation', 'Won', 'Lost'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- NOTE: crm.deals.status — already constrained by deals_status_check (0010)
-- covering ('active','won','lost','cancelled','deleted'). Nothing to add.
-- ============================================================================

-- ============================================================================
-- NOTE: crm.activities.status — already constrained by
-- activities_status_check (0010) covering ('open','completed','cancelled').
-- Nothing to add.
-- ============================================================================

-- ============================================================================
-- NOTE: crm.activities.type — already constrained by
-- activities_type_check (0010) covering
-- ('call','meeting','email','task','note','complaint'). Nothing to add.
-- ============================================================================

-- ============================================================================
-- NOTE: crm.accounts.status — already constrained by
-- accounts_status_check (0010) covering ('active','inactive','churned').
-- Nothing to add.
-- ============================================================================

-- ============================================================================
-- NOTE: crm.contacts.status — already constrained by
-- contacts_status_check (0010) covering ('active','inactive','deleted').
-- Nothing to add.
-- ============================================================================

-- ============================================================================
-- NOTE: crm.contacts.lead_status — already constrained by
-- contacts_lead_status_check (0010) covering
-- ('new','contacted','qualified','unqualified','converted'). Nothing to add.
-- ============================================================================

-- ============================================================================
-- NOTE: crm.contacts.lead_source — free-form varchar(64), not validated via
-- zod enum. Not a state machine column. Skipped.
-- ============================================================================

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE crm.deals VALIDATE CONSTRAINT deals_stage_check;
