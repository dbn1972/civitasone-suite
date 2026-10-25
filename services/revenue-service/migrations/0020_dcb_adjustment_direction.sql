-- revenue-service migration 0020 - explicit adjustment direction on the DCB ledger
-- Applied AFTER 0019_waiver_type.sql
-- Rollback:
--   ALTER TABLE assessment.dcb_entries DROP CONSTRAINT IF EXISTS chk_dcb_adjustment_direction;
--   ALTER TABLE assessment.dcb_entries DROP COLUMN IF EXISTS adjustment_direction;
--
-- An `adjustment` is written as two equal legs (debit the source demand,
-- credit the target demand). Readers identified the leg by parsing the
-- narration text ("Adjustment credit..."), which breaks the moment the wording
-- changes. This adds an explicit nullable column (credit | debit), backfills
-- existing adjustment rows from their narration ONCE, and from now on writers
-- set it and readers use it. Narration parsing is removed from the code.
-- Additive; existing table grants cover the new column.
--
-- assessment.dcb_entries has FORCE ROW LEVEL SECURITY (0002), which applies to
-- the owner running this migration too, so the backfill UPDATE would match no
-- rows. Wrap it in NO FORCE / FORCE.

SET lock_timeout = '5s';

ALTER TABLE assessment.dcb_entries
  ADD COLUMN IF NOT EXISTS adjustment_direction varchar(8);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_dcb_adjustment_direction'
  ) THEN
    ALTER TABLE assessment.dcb_entries
      ADD CONSTRAINT chk_dcb_adjustment_direction
      CHECK (adjustment_direction IS NULL OR adjustment_direction IN ('credit', 'debit'));
  END IF;
END $$;

ALTER TABLE assessment.dcb_entries NO FORCE ROW LEVEL SECURITY;

-- Backfill: the credit leg was written with narration "Adjustment credit: ...";
-- every other adjustment row was the debit leg (the historical reader rule).
UPDATE assessment.dcb_entries
   SET adjustment_direction = CASE WHEN narration LIKE 'Adjustment credit%' THEN 'credit' ELSE 'debit' END
 WHERE entry_type = 'adjustment'
   AND adjustment_direction IS NULL;

ALTER TABLE assessment.dcb_entries FORCE ROW LEVEL SECURITY;
