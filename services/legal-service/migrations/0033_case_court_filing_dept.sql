-- Migration: 0033_case_court_filing_dept
-- Purpose: GAP-LEGAL-CASES-NEW-02 (owner decision #10). Cases carry the court-master code
--   (or 'other' for a free-text forum), whether the court is verified (taken from the master),
--   the filing date and the owning department (id from the org hierarchy, hrms departments).
--   Pre-existing rows keep NULLs / court_verified = false: they were free text and stay
--   "unverified" until corrected; nothing is back-filled or guessed.
-- Rollback:
--   ALTER TABLE cases.legal_cases DROP COLUMN IF EXISTS court_code, DROP COLUMN IF EXISTS court_verified,
--     DROP COLUMN IF EXISTS filing_date, DROP COLUMN IF EXISTS department_id;
-- Affected services: legal-service

SET lock_timeout = '5s';

ALTER TABLE cases.legal_cases
  ADD COLUMN IF NOT EXISTS court_code     TEXT,
  ADD COLUMN IF NOT EXISTS court_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS filing_date    DATE,
  ADD COLUMN IF NOT EXISTS department_id  UUID;

CREATE INDEX IF NOT EXISTS idx_legal_cases_department
  ON cases.legal_cases (tenant_id, department_id);
