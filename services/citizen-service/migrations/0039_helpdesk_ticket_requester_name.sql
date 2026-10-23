-- citizen-service migration 0039 — helpdesk tickets: record the reporter's name
-- as its own column. The web intake form used to fold "Reported by: <name>" into
-- the free-text description because the API had no field for it. Additive,
-- idempotent, nullable (existing tickets have no recorded name).

SET lock_timeout = '5s';

ALTER TABLE helpdesk.citizen_tickets
  ADD COLUMN IF NOT EXISTS requester_name varchar(200);

-- Rollback:
--   ALTER TABLE helpdesk.citizen_tickets DROP COLUMN IF EXISTS requester_name;
