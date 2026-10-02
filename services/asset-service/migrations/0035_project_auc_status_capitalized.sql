-- Migration: 0035_project_auc_status_capitalized.sql
-- 0011 allowed the British spelling "capitalised", but the enterprise consumer, the
-- API payloads and the web all use "capitalized". Every capitalize therefore failed
-- the CHECK and rolled back (no asset created, AUC stuck under_construction).
-- Accept both spellings so any existing "capitalised" rows stay valid.
-- Idempotent. Rollback: restore the 0011 constraint (only valid if no "capitalized" rows exist).

SET lock_timeout = '5s';

ALTER TABLE enterprise.project_auc DROP CONSTRAINT IF EXISTS project_auc_status_check;
ALTER TABLE enterprise.project_auc
  ADD CONSTRAINT project_auc_status_check
  CHECK (status IN ('under_construction', 'capitalized', 'capitalised', 'cancelled'));
