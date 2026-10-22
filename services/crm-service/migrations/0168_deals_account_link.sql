-- GAP-CRM-OPPORTUNITIES-NEW-02: a deal can be linked directly to an account.
--
-- Until now a deal reached its account only indirectly (deals.contact_id ->
-- contacts.account_id), so an opportunity captured against an account with no
-- contact chosen was never persisted against that account and never appeared on
-- the account's 360 view. account_id is the direct, optional link.
--
-- Additive + idempotent: one nullable column (NULL = not linked to an account,
-- which is every existing row, so no backfill) plus a partial index for the
-- account-scoped lookup. Whether an account becomes mandatory is a product
-- decision and is deliberately NOT enforced here.
--
-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS crm.idx_deals_tenant_account_id;
--   ALTER TABLE crm.deals DROP COLUMN IF EXISTS account_id;
-- Affected services: crm-service (deals module; contacts module account 360 view)
SET lock_timeout = '5s';

ALTER TABLE crm.deals
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES crm.accounts(id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deals_tenant_account_id
  ON crm.deals (tenant_id, account_id) WHERE account_id IS NOT NULL;
