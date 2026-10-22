-- citizen-service migration 0038 — helpdesk notes: real staff-only flag.
-- Before this, the web sent an "internal note" as a public note prefixed with
-- "[INTERNAL] " and the read model hardcoded isInternal=false, so the owning
-- citizen could read staff-only notes. is_internal is filtered out of every
-- citizen-facing read in helpdesk/repo.ts. Additive, idempotent; existing rows
-- are public (false), matching how they were already served.

SET lock_timeout = '5s';

ALTER TABLE helpdesk.citizen_ticket_notes
  ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;

-- Rollback:
--   ALTER TABLE helpdesk.citizen_ticket_notes DROP COLUMN IF EXISTS is_internal;
