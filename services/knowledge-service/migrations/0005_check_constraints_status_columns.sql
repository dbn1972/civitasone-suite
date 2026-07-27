-- Purpose: Add CHECK constraints on all status/type columns to restrict values to defined state machine states
-- Rollback: ALTER TABLE ... DROP CONSTRAINT IF EXISTS <constraint_name> for each constraint below
-- Affected services: knowledge-service
--
-- AMENDED 2026-07-27 — idempotency repair, no behaviour change.
--
-- The knowledge.search_index blocks referenced a table that no migration ever
-- created (created by 0011_missing_module_tables.sql). The DO block trapped only
-- `duplicate_object`, not `undefined_table`, so on a fresh database this file
-- aborted at the search_index ALTER and, with ON_ERROR_STOP=1, skipped the
-- VALIDATE pass for knowledge.documents as well — leaving the documents
-- constraint NOT VALID. bootstrap-postgres.sh logged a warning and continued, so
-- the file's failure was invisible.
--
-- Fixed by guarding each block on table existence. 0011 creates
-- search_index_status_check itself, under this same name, so a fresh database ends
-- up with the constraint regardless of the order the two files run in.

SET lock_timeout = '5s';

-- ============================================================================
-- knowledge.documents.status
-- Valid states: draft, under_review, approved, archived (routes.ts status list)
-- ============================================================================
DO $$ BEGIN
  IF to_regclass('knowledge.documents') IS NOT NULL THEN
    BEGIN
      ALTER TABLE knowledge.documents
        ADD CONSTRAINT documents_status_check
        CHECK (status IN ('draft', 'under_review', 'approved', 'archived'))
        NOT VALID;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

-- ============================================================================
-- knowledge.search_index.status
-- Valid states: indexed (schema default; no other transition implemented)
-- ============================================================================
DO $$ BEGIN
  IF to_regclass('knowledge.search_index') IS NOT NULL THEN
    BEGIN
      ALTER TABLE knowledge.search_index
        ADD CONSTRAINT search_index_status_check
        CHECK (status IN ('indexed'))
        NOT VALID;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'documents_status_check'
                AND conrelid = to_regclass('knowledge.documents')) THEN
    ALTER TABLE knowledge.documents VALIDATE CONSTRAINT documents_status_check;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'search_index_status_check'
                AND conrelid = to_regclass('knowledge.search_index')) THEN
    ALTER TABLE knowledge.search_index VALIDATE CONSTRAINT search_index_status_check;
  END IF;
END $$;
