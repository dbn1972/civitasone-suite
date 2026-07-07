-- Purpose: Create missing FK indexes using CREATE INDEX CONCURRENTLY for non-blocking index creation.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS each index listed below.
-- Affected services: report-service only.
-- Safety: IF NOT EXISTS ensures idempotency. CONCURRENTLY avoids table locks.
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.

SET lock_timeout = '5s';

-- reports.jobs.requested_by (FK-style lookup column — joins to user for "who requested" queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_requested_by
  ON reports.jobs (requested_by) WHERE requested_by IS NOT NULL;

-- reports.jobs.created_by (FK-style lookup column — user audit trail)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_created_by
  ON reports.jobs (created_by);

-- reports.jobs.updated_by (FK-style lookup column — user audit trail)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_updated_by
  ON reports.jobs (updated_by);

-- reports.kpis.created_by (FK-style lookup column — user audit trail)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_kpis_created_by
  ON reports.kpis (created_by);

-- reports.kpis.updated_by (FK-style lookup column — user audit trail)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_kpis_updated_by
  ON reports.kpis (updated_by);

-- reports.report_schedules.tenant_id (FK-style lookup column — tenant isolation queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_report_schedules_tenant_id
  ON reports.report_schedules (tenant_id);

-- reports.report_schedules.created_by (FK-style lookup column — user audit trail)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_report_schedules_created_by
  ON reports.report_schedules (created_by);
