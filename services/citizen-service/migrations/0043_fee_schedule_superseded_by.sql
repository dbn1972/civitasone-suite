-- citizen-service migration 0043 -- fee.schedules: supersede (retire) instead of duplicate.
-- CLOS3-S1-11. Editing a saved fee used to POST a brand-new schedule and leave the old one
-- active next to it. PATCH /v1/citizen/fees/schedules/:id now retires the old row
-- (active = false) and inserts the successor; `superseded_by` records the lineage.
-- Additive, idempotent, nullable. No new table, so RLS (ENABLE + FORCE from 0015) is unchanged.
-- Money stays bigint paise (base_amount, 0018).

SET lock_timeout = '5s';

ALTER TABLE fee.schedules
  ADD COLUMN IF NOT EXISTS superseded_by uuid;

-- Rollback:
--   ALTER TABLE fee.schedules DROP COLUMN IF EXISTS superseded_by;
--   (rows retired by the endpoint keep active = false; to restore the pre-edit
--    schedule: UPDATE fee.schedules SET active = true WHERE id = '<old id>';)
