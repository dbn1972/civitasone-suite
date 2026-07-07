-- Purpose: Add CHECK constraints on remaining status/type columns lacking them (follow-up to 0007_check_constraints_status_columns.sql)
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: admin-service

SET lock_timeout = '5s';

-- ============================================================================
-- webhooks.webhook_deliveries.event_type
-- SKIPPED: this column mirrors the tenant's own arbitrary, tenant-chosen
-- webhook subscription topics. Per webhooks/consumer.ts doc comment, the
-- consumer "listens to ALL domain events" across every microservice and
-- fans out any matching event to registered webhooks — there is no closed
-- enumeration of possible event_type values (a tenant can subscribe to any
-- cross-service event topic name, e.g. "finance.bill.approved",
-- "hrms.employee.onboarded", etc., and admin-service has no local registry
-- constraining which topics are valid). No CHECK constraint added — would
-- require guessing at a value set that does not exist as a fixed list.
-- ============================================================================

-- No constraints to VALIDATE — this migration only documents the skip decision above.
