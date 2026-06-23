-- SYN-1 / 03-T7: per-user row ownership for the sync changelog.
--
-- pull was tenant+mailbox scoped only, so within a tenant any authorised user
-- could pull another user's rows from a personal mailbox (e.g. notifications).
-- This adds an optional owner_user_id; for user-private mailboxes, pull is
-- filtered to `owner_user_id = <actor> OR owner_user_id IS NULL`. NULL rows
-- remain shared (no regression for events that don't carry an owner); rows
-- explicitly owned by another user are no longer visible.

ALTER TABLE sync.entity_changelog ADD COLUMN IF NOT EXISTS owner_user_id UUID;

CREATE INDEX IF NOT EXISTS idx_changelog_owner
  ON sync.entity_changelog (tenant_id, mailbox, owner_user_id, seq);
