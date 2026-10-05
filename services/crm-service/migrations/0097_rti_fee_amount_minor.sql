-- GAP-CRM-RTI-NEW-01: money must travel and be stored as bigint minor units
-- (paise), per CLAUDE.md §3.11, never as a rupees float. The RTI application
-- fee was stored as numeric(10,2) rupees (fee_amount) and the web form posted
-- it as a JSON number in rupees, inviting float rounding and contradicting the
-- platform rule.
--
-- Expand step (additive, idempotent): add fee_amount_minor bigint (paise) and
-- backfill it from the existing rupees column, rounding to the nearest paisa.
-- The old fee_amount column is LEFT IN PLACE this release (contract/contract
-- expand pattern) so any not-yet-deployed reader keeps working; a later
-- contract migration can drop it once all callers read fee_amount_minor.
-- Rollback: ALTER TABLE crm.rti_requests DROP COLUMN IF EXISTS fee_amount_minor;
SET lock_timeout = '5s';

ALTER TABLE crm.rti_requests
  ADD COLUMN IF NOT EXISTS fee_amount_minor bigint;

-- Backfill existing rows: rupees -> paise, rounded to the nearest paisa. Only
-- touch rows that have a rupees value but no minor value yet (idempotent, and
-- safe to re-run).
-- crm.rti_requests is FORCE RLS (0092) and this migration runs with no tenant
-- GUC, so a plain UPDATE would match zero rows (or fail in the CI bootstrap).
-- Lift FORCE for the one-shot cross-tenant backfill, then restore it.
ALTER TABLE crm.rti_requests NO FORCE ROW LEVEL SECURITY;

UPDATE crm.rti_requests
   SET fee_amount_minor = round(fee_amount * 100)::bigint
 WHERE fee_amount IS NOT NULL
   AND fee_amount_minor IS NULL;

ALTER TABLE crm.rti_requests FORCE ROW LEVEL SECURITY;
