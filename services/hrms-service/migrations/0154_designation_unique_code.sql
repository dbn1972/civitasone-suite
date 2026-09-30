-- 0154_designation_unique_code.sql
-- GAP-HR-DESIGNATIONS-NEW-02: hrms_designations had no uniqueness
-- constraint on `code` at all -- two designations could carry the same
-- code (case-insensitive), with the create route now doing a synchronous
-- check (POST /v1/hrms/designations) but that alone can't close a race
-- between two concurrent creates. This functional unique index is the
-- real backstop; the consumer insert now fails (transaction rolled back,
-- logged) instead of silently persisting a duplicate.
--
-- Not verified against a populated environment (no reachable dev DB
-- connection string from this worktree) -- PR #1661 (unmerged, touches
-- the same designations code) noted 0 rows in hrms_designations in its
-- dev DB check. If any tenant already has duplicate (tenant_id, lower(code))
-- rows, this migration will fail to apply rather than silently corrupt
-- anything -- dedupe first if that happens. Additive + idempotent otherwise.
--
-- Rollback: DROP INDEX IF EXISTS employee.hrms_designations_tenant_code_uidx;

SET lock_timeout = '5s';

CREATE UNIQUE INDEX IF NOT EXISTS hrms_designations_tenant_code_uidx
  ON employee.hrms_designations (tenant_id, lower(code));
