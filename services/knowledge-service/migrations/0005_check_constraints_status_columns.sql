-- Purpose: Add CHECK constraints on all status/type columns to restrict values to defined state machine states
-- Rollback: ALTER TABLE ... DROP CONSTRAINT IF EXISTS <constraint_name> for each constraint below
-- Affected services: knowledge-service

SET lock_timeout = '5s';

-- ============================================================================
-- knowledge.documents.status
-- Valid states: draft, under_review, approved, archived (routes.ts status list)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE knowledge.documents
    ADD CONSTRAINT documents_status_check
    CHECK (status IN ('draft', 'under_review', 'approved', 'archived'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- knowledge.search_index.status
-- Valid states: indexed (schema default; no other transition implemented)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE knowledge.search_index
    ADD CONSTRAINT search_index_status_check
    CHECK (status IN ('indexed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE knowledge.documents VALIDATE CONSTRAINT documents_status_check;
ALTER TABLE knowledge.search_index VALIDATE CONSTRAINT search_index_status_check;
