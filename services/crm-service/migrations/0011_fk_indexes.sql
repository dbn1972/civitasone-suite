-- Purpose: Create missing FK indexes using CREATE INDEX CONCURRENTLY for non-blocking index creation.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS each index listed below.
-- Affected services: crm-service only.
-- Safety: IF NOT EXISTS ensures idempotency. CONCURRENTLY avoids table locks.
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.

SET lock_timeout = '5s';

-- crm.contacts.account_id → crm.accounts
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_account_id
  ON crm.contacts (account_id) WHERE account_id IS NOT NULL;

-- crm.deals.contact_id → crm.contacts (tenant-scoped composite already exists via idx_deals_contact — skip standalone)

-- crm.deals.owner_id (FK to user — used for sales rep pipeline views)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deals_owner_id
  ON crm.deals (owner_id) WHERE owner_id IS NOT NULL;

-- crm.activities.deal_id → crm.deals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activities_deal_id
  ON crm.activities (deal_id) WHERE deal_id IS NOT NULL;
