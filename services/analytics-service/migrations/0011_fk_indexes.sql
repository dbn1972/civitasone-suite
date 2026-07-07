-- Purpose: Create missing FK indexes using CREATE INDEX CONCURRENTLY for non-blocking index creation.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS each index listed below.
-- Affected services: analytics-service only.
-- Safety: IF NOT EXISTS ensures idempotency. CONCURRENTLY avoids table locks.
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.

SET lock_timeout = '5s';

-- analytics.dashboards.owner_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dashboards_owner_id
  ON analytics.dashboards (owner_id);

-- analytics.dashboard_widgets.dashboard_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dashboard_widgets_dashboard_id
  ON analytics.dashboard_widgets (dashboard_id);

-- analytics.dashboard_shares.dashboard_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dashboard_shares_dashboard_id
  ON analytics.dashboard_shares (dashboard_id);

-- analytics.dashboard_shares.principal_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dashboard_shares_principal_id
  ON analytics.dashboard_shares (principal_id);

-- analytics.export_jobs.query_run_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_export_jobs_query_run_id
  ON analytics.export_jobs (query_run_id);

-- analytics.query_runs.dashboard_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_query_runs_dashboard_id
  ON analytics.query_runs (dashboard_id);
