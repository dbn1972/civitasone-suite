-- Migration: 0034_case_privileged
-- Purpose: GAP-LEGAL-CASES-DETAIL-06 (owner decision #12). A privileged/confidential flag restricts
--   a case (and its sub-resources and list/aggregate appearances) to its assigned officers
--   (cases.legal_cases.assigned_officer_ids, 0031) and the legal head (role legal_admin).
--   Existing cases stay non-privileged.
-- Rollback:
--   DROP INDEX IF EXISTS cases.idx_legal_cases_privileged;
--   ALTER TABLE cases.legal_cases DROP COLUMN IF EXISTS privileged;
-- Affected services: legal-service

SET lock_timeout = '5s';

ALTER TABLE cases.legal_cases
  ADD COLUMN IF NOT EXISTS privileged BOOLEAN NOT NULL DEFAULT FALSE;

-- Only privileged cases are ever looked up by the access filter.
CREATE INDEX IF NOT EXISTS idx_legal_cases_privileged
  ON cases.legal_cases (tenant_id) WHERE privileged = TRUE;
