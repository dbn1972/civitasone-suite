-- Migration: 0007_erasure_requested_at.sql
-- Purpose: Add erasure_requested_at column to visitor.visit_requests for DPDP
--          right-to-erasure tracking (Requirement 18.4). When a visitor exercises
--          their right to erasure, this timestamp is set. A scheduled purge worker
--          then erases PII within 72 hours.
-- Depends on: 0002_visit_requests_digital_passes.sql
-- Rollback: ALTER TABLE visitor.visit_requests DROP COLUMN IF EXISTS erasure_requested_at;
-- Safety: additive, idempotent (column added only IF NOT EXISTS equivalent via DO block).

SET lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'visitor'
      AND table_name = 'visit_requests'
      AND column_name = 'erasure_requested_at'
  ) THEN
    ALTER TABLE visitor.visit_requests
      ADD COLUMN erasure_requested_at timestamptz;
  END IF;
END $$;
