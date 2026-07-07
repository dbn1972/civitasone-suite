-- Purpose: Create missing FK indexes using CREATE INDEX CONCURRENTLY for non-blocking index creation.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS each index listed below.
-- Affected services: admin-service only.
-- Safety: IF NOT EXISTS ensures idempotency. CONCURRENTLY avoids table locks.
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.

SET lock_timeout = '5s';

-- scheduled_jobs.job_execution_history.job_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_execution_history_job_id
  ON scheduled_jobs.job_execution_history (job_id);

-- support.admin_break_glass_log.ticket_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admin_break_glass_log_ticket_id
  ON support.admin_break_glass_log (ticket_id);

-- support.admin_break_glass_log.actor_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admin_break_glass_log_actor_id
  ON support.admin_break_glass_log (actor_id);

-- webhooks.webhook_deliveries.webhook_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webhook_deliveries_webhook_id
  ON webhooks.webhook_deliveries (webhook_id);
