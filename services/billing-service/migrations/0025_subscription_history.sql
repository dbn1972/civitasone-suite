-- 0025_subscription_history.sql
-- GAP-BILLING-SUBSCRIPTIONS-03 (review r1, owner decision 2026-10-27: build the missing backend):
-- a tenant can have PAST subscriptions. 0001 declared UNIQUE (tenant_id), so a cancelled tenant
-- could never subscribe again and no history could exist. Replace it with a partial unique index:
-- at most ONE non-cancelled (current) subscription per tenant, any number of cancelled (past) ones.
-- No new table, so the existing FORCE RLS policies on subscriptions.billing_subscriptions apply.
-- Idempotent.
-- Rollback: DROP INDEX subscriptions.uq_billing_subscriptions_one_current_per_tenant;
--   then ALTER TABLE subscriptions.billing_subscriptions ADD CONSTRAINT billing_subscriptions_tenant_id_key UNIQUE (tenant_id);
--   (the re-add fails while any tenant holds more than one row; remove the past rows first).
-- Affected services: billing-service

SET lock_timeout = '5s';

ALTER TABLE subscriptions.billing_subscriptions DROP CONSTRAINT IF EXISTS billing_subscriptions_tenant_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_subscriptions_one_current_per_tenant
  ON subscriptions.billing_subscriptions (tenant_id)
  WHERE status <> 'cancelled';
