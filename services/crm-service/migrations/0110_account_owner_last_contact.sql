-- F5-01 / F5-02: an account can carry an owner (the responsible agent) and a
-- denormalised "last contact" timestamp.
--
-- owner_id (F5-01): the identity user responsible for the account. NULL means
-- unassigned, so existing rows need no backfill. The web resolves the id to a
-- name via the CRM agent directory (never shows a raw UUID).
--
-- last_contact_at (F5-02): the created_at of the latest activity linked to the
-- account. Denormalised onto the account the SAME way crm.contacts.last_activity_at
-- is maintained (the activities consumer touches it in the same transaction as
-- the activity write), so the accounts list / health watchlist can show a "Last
-- contact" column WITHOUT a cross-module JOIN into crm.activities. NULL means
-- "no activity recorded yet".
--
-- Additive + idempotent: two nullable columns, no backfill, no default churn.
-- Rollback:
--   ALTER TABLE crm.accounts DROP COLUMN IF EXISTS last_contact_at;
--   ALTER TABLE crm.accounts DROP COLUMN IF EXISTS owner_id;
-- Affected services: crm-service (contacts module — accounts)
SET lock_timeout = '5s';

ALTER TABLE crm.accounts
  ADD COLUMN IF NOT EXISTS owner_id uuid;

ALTER TABLE crm.accounts
  ADD COLUMN IF NOT EXISTS last_contact_at timestamptz;
