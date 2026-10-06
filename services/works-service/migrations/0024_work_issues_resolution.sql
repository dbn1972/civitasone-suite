-- Purpose: GAP-WORKS-EXECUTION-ISSUES-04 — record a resolution note when an
--          issue is closed, so a close carries why/how it was resolved.
-- Rollback: ALTER TABLE works.work_issues DROP COLUMN IF EXISTS resolution;
-- Affected services: works-service

SET lock_timeout = '5s';

-- Additive + idempotent: a nullable text column, no backfill needed (existing
-- rows legitimately have no resolution recorded). Column inherits the table's
-- existing grants and RLS policy, so no new GRANT is required.
ALTER TABLE works.work_issues
  ADD COLUMN IF NOT EXISTS resolution varchar(2048);
