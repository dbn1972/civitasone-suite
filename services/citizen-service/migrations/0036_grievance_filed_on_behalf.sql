-- citizen-service migration 0036 — GAP-CITIZEN-GRIEVANCES-NEW-02: record who
-- filed a grievance and (for officer-filed grievances) the complainant's
-- contact + a filed-on-behalf flag, so a signed-in officer filing for a citizen
-- is attributable and the complainant is reachable. Additive, idempotent.
--
-- filed_by_actor      : the JWT sub of the actor who filed (officer or citizen).
-- filed_on_behalf     : true when an officer filed for someone else.
-- complainant_name    : free-text applicant name (already captured by the web).
-- complainant_contact : jsonb array of {kind: mobile|email, value}. PII — the
--                       read model masks it; never logged.

SET lock_timeout = '5s';

ALTER TABLE grievance.citizen_grievances
  ADD COLUMN IF NOT EXISTS filed_by_actor      uuid,
  ADD COLUMN IF NOT EXISTS filed_on_behalf     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS complainant_name    text,
  ADD COLUMN IF NOT EXISTS complainant_contact jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Rollback:
--   ALTER TABLE grievance.citizen_grievances
--     DROP COLUMN IF EXISTS filed_by_actor,
--     DROP COLUMN IF EXISTS filed_on_behalf,
--     DROP COLUMN IF EXISTS complainant_name,
--     DROP COLUMN IF EXISTS complainant_contact;
