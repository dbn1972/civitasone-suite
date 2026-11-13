-- Migration: 0035_reports_rejection.sql
-- Gap-fix wave (11 Nov 2026), HANDOFF 5 item 7. Idempotent; safe to re-run.
--
-- Inspection reports could not be rejected: `rejected` was allowed by chk_report_status but no
-- command reached it. The reject path records who rejected, when and why. All three columns are
-- nullable with no default and no backfill (catalog-only change); existing rows are unaffected.
-- Table-level grants to inspection_svc and the RLS policy rls_reports cover new columns unchanged.
--
-- A rejected report is not terminal: the inspector may revise it and submit it again
-- (rejected -> submitted), mirroring how a rejected tour plan returns to draft. The last rejection
-- stays on the row for the reviewer; every rejection is also in the audit trail.
--
-- Rollback:
--   ALTER TABLE reports.inspection_reports
--     DROP COLUMN IF EXISTS rejection_reason, DROP COLUMN IF EXISTS rejected_by, DROP COLUMN IF EXISTS rejected_at;

SET lock_timeout = '5s';

ALTER TABLE reports.inspection_reports ADD COLUMN IF NOT EXISTS rejected_at timestamptz;
ALTER TABLE reports.inspection_reports ADD COLUMN IF NOT EXISTS rejected_by uuid;
ALTER TABLE reports.inspection_reports ADD COLUMN IF NOT EXISTS rejection_reason text;
