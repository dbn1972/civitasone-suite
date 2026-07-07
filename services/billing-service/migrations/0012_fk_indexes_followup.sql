-- Purpose: Follow-up FK index audit — create remaining missing FK-lookup indexes
--          not covered by the earlier fk_indexes migration, using CREATE INDEX CONCURRENTLY.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS each index listed below.
-- Affected services: billing-service only.
-- Safety: IF NOT EXISTS ensures idempotency. CONCURRENTLY avoids table locks.
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.

SET lock_timeout = '5s';

-- plans.billing_plan_features.plan_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_billing_plan_features_plan_id
  ON plans.billing_plan_features (plan_id);

-- subscriptions.billing_trials.subscription_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_billing_trials_subscription_id
  ON subscriptions.billing_trials (subscription_id);
