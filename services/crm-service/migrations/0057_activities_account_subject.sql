-- Purpose: AC-001 / CM-004 — let an activity be attached to an account subject.
--   crm.activities already carries contact_id and deal_id; add a nullable account_id
--   so the per-record activity timeline (GET /v1/crm/activities?subjectType=account)
--   is both possible AND tenant+subject scoped. Without it, an account-page feed had
--   no column to filter on and fell back to a tenant-wide list (same-tenant leak).
-- Rollback: ALTER TABLE crm.activities DROP COLUMN IF EXISTS account_id;
-- Affected services: crm-service (activities module)
-- Sequencing: additive nullable column + partial index; no backfill.

SET lock_timeout = '5s';

ALTER TABLE crm.activities ADD COLUMN IF NOT EXISTS account_id uuid;

-- Subject-scoped timeline read for account subjects.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activities_account_id
  ON crm.activities(tenant_id, account_id) WHERE account_id IS NOT NULL;
