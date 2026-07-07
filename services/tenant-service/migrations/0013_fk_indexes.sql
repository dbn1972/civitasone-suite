-- Purpose: Create missing FK indexes using CREATE INDEX CONCURRENTLY for non-blocking index creation.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS each index listed below.
-- Affected services: tenant-service only.
-- Safety: IF NOT EXISTS ensures idempotency. CONCURRENTLY avoids table locks.
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.

SET lock_timeout = '5s';

-- subscriptions.subscriptions.plan_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_plan_id
  ON subscriptions.subscriptions (plan_id);
