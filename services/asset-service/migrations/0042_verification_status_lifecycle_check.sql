-- Migration: 0042_verification_status_lifecycle_check.sql
-- UAT DB test defect (asset-service, 2026-10-28): POST /v1/assets/verifications/:id/submit answered 202 but never
-- persisted. The consumer moves a session draft -> submitted (verification/consumer.ts) and approve requires
-- "submitted" (verification/domain.ts), but the live physical_verifications_status_check only allowed
-- draft / in_progress / completed / approved (an earlier shape of 0011, whose guarded ADD CONSTRAINT is a no-op where the
-- constraint already exists), so the UPDATE violated the CHECK and the verification workflow could never complete.
-- 0011 is an applied migration and is not edited; this one replaces the constraint with the real lifecycle.
--
-- The new set is a SUPERSET of both historical shapes (draft, in_progress, completed, submitted, approved), so every
-- existing row satisfies it and it can be added validated. Idempotent: safe on a database that already has the 0011
-- (draft, submitted, approved) shape and on one that has the older shape.
--
-- Rollback (only valid while no row is submitted/in_progress/completed):
--   ALTER TABLE lifecycle.physical_verifications DROP CONSTRAINT IF EXISTS physical_verifications_status_check;
--   ALTER TABLE lifecycle.physical_verifications ADD CONSTRAINT physical_verifications_status_check
--     CHECK (status IN ('draft', 'in_progress', 'completed', 'approved'));

SET lock_timeout = '5s';

ALTER TABLE lifecycle.physical_verifications DROP CONSTRAINT IF EXISTS physical_verifications_status_check;
ALTER TABLE lifecycle.physical_verifications
  ADD CONSTRAINT physical_verifications_status_check
  CHECK (status IN ('draft', 'in_progress', 'submitted', 'completed', 'approved'));
