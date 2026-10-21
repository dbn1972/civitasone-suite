-- GAP-CRM-HEALTH-ACCOUNTID-03: a service request raised as an account follow-up
-- (Account Health -> "Create Follow-up") must carry the account it is about.
-- The web modal has always sent `relatedAccountId`, but crm-service stripped it
-- (not in createBody) and crm.service_requests had no column for it, so the
-- created record never knew which account it belonged to.
--
-- related_account_id: the crm.accounts row this request is a follow-up for.
-- NULL for ordinary citizen requests, so existing rows need no backfill. Plain
-- uuid with NO foreign key, like contact_id on this table: the service validates
-- tenant ownership on write (422 ACCOUNT_NOT_FOUND) and an account later merged
-- or archived must not block the request's history.
--
-- Additive + idempotent: one nullable column and one partial index, no backfill,
-- no default churn.
-- Rollback:
--   DROP INDEX IF EXISTS crm.idx_service_requests_tenant_related_account;
--   ALTER TABLE crm.service_requests DROP COLUMN IF EXISTS related_account_id;
-- Affected services: crm-service (service-requests module)
SET lock_timeout = '5s';

ALTER TABLE crm.service_requests
  ADD COLUMN IF NOT EXISTS related_account_id uuid;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_service_requests_tenant_related_account
  ON crm.service_requests (tenant_id, related_account_id) WHERE related_account_id IS NOT NULL;
