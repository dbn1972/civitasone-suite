-- citizen-service migration 0038 — helpdesk notes: real staff-only flag.
-- Before this, the web sent an "internal note" as a public note prefixed with
-- "[INTERNAL] " and the read model hardcoded isInternal=false, so the owning
-- citizen could read staff-only notes. is_internal is filtered out of every
-- citizen-facing read in helpdesk/repo.ts. Idempotent. New column defaults to false;
-- legacy prefixed notes are backfilled below.

SET lock_timeout = '5s';

BEGIN;

ALTER TABLE helpdesk.citizen_ticket_notes
  ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;

-- Backfill: staff notes saved by the old web convention carry an "[INTERNAL] "
-- body prefix and are currently readable by the owning citizen. Flag them and
-- strip the prefix. citizen_ticket_notes is FORCE ROW LEVEL SECURITY and this
-- migration runs as citizen_svc (NOBYPASSRLS, but the table owner), and the
-- policy calls current_setting('app.tenant_id', false) which errors when unset.
-- So, as the owner, lift FORCE for this one cross-tenant data fix and restore it
-- in the same transaction (the owner is exempt from non-forced RLS).
-- Idempotent: only rows that still carry the prefix are touched.
ALTER TABLE helpdesk.citizen_ticket_notes NO FORCE ROW LEVEL SECURITY;

UPDATE helpdesk.citizen_ticket_notes
   SET is_internal = true,
       body = substr(body, length('[INTERNAL] ') + 1)
 WHERE left(body, length('[INTERNAL] ')) = '[INTERNAL] ';

ALTER TABLE helpdesk.citizen_ticket_notes FORCE ROW LEVEL SECURITY;

COMMIT;

-- Rollback (the backfill is not reversed; the prefix is not restored):
--   ALTER TABLE helpdesk.citizen_ticket_notes DROP COLUMN IF EXISTS is_internal;
