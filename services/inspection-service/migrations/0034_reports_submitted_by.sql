-- Migration: 0034_reports_submitted_by.sql
-- UAT bundle 9 (B9-insp). Idempotent; safe to re-run.
--
-- reports.inspection_reports recorded no submitter. The F63 approve path used updated_by as a proxy
-- for it, which only holds while nothing else writes the row between submit and approve, and the
-- audit trail could not name who submitted. Add submitted_by, set from the JWT actor on submit.
--
-- Nullable, no default and no backfill: existing rows keep NULL (the approve path falls back to
-- updated_by for them, which is the submitter while a legacy row is still submitted). Adding a
-- nullable column without a default is a catalog-only change. Table-level grants to inspection_svc
-- and the forced RLS policy rls_reports cover the new column unchanged.
--
-- Rollback:
--   ALTER TABLE reports.inspection_reports DROP COLUMN IF EXISTS submitted_by;

SET lock_timeout = '5s';

ALTER TABLE reports.inspection_reports ADD COLUMN IF NOT EXISTS submitted_by uuid;
