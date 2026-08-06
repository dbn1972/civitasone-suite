-- Purpose: G12 (Spec §25.7, Journey J6) — let an opportunity be registered UNDER a
--   government programme, which is the concrete thing J6 asks for. crm.deals gains a
--   nullable programme_id pointing at crm.programmes.
--
--   STRICTLY ADDITIVE. The column is nullable with no default and no backfill, so every
--   existing deal keeps programme_id NULL and every existing code path behaves exactly as
--   before: nothing reads it as a required field, no existing response field is removed or
--   renamed, and the deals module's own writes are untouched. Only the new
--   crm.programme.link_deal command sets it.
--
--   No FOREIGN KEY on purpose. crm.deals is written by hot paths under FORCE RLS; adding an
--   FK would make every deal insert take a row lock on crm.programmes and would fail closed
--   if a programme were ever archived out from under a historic deal. The link command
--   validates the programme exists in the same tenant before it writes, which is where the
--   check belongs in a CQRS service.
--
-- Rollback:
--   DROP INDEX IF EXISTS crm.idx_deals_programme;
--   ALTER TABLE crm.deals DROP COLUMN IF EXISTS programme_id;
--   (Dropping a never-NOT-NULL, never-defaulted column added by this migration is safe;
--    it requires tech-lead approval per the migration policy on DROP.)
--
-- Affected services: crm-service only. The programmes module both writes this column
--   (crm.programme.link_deal) and reads it back (programmes/repo.ts, raw SQL, so the
--   deals module's Drizzle schema stays untouched). The deals module itself does NOT
--   select or expose `programmeId` today — its responses are byte-for-byte unchanged.
--   No other service reads crm.deals directly.
--
-- Sequencing: additive. Depends on 0086_programmes.sql only conceptually — no FK is
--   created, so the two can be applied in either order.

SET lock_timeout = '5s';

ALTER TABLE crm.deals ADD COLUMN IF NOT EXISTS programme_id uuid;

-- Partial index: only linked deals are ever filtered by programme, and the vast majority
-- of rows are NULL, so indexing them would be dead weight.
CREATE INDEX IF NOT EXISTS idx_deals_programme
  ON crm.deals (tenant_id, programme_id)
  WHERE programme_id IS NOT NULL;
