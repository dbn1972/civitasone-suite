-- Purpose: owner decision D4c #43 (GAP-WORKS-EXECUTION-RECORD-PROGRESS-06) — one progress entry per scope per month.
--          A correction is a separate negative entry with a reason (entry_kind = 'correction'), so it does not
--          collide with the month's ordinary entry. Rows that already break the rule are KEPT (the running total
--          still sums them) and reclassified as 'legacy_duplicate'; only the earliest ordinary row of a month stays
--          'progress'.
-- Rollback: DROP INDEX IF EXISTS works.uq_scope_progress_period;
--           ALTER TABLE works.scope_progress DROP COLUMN IF EXISTS entry_kind, DROP COLUMN IF EXISTS correction_reason;
-- Affected services: works-service

SET lock_timeout = '5s';

ALTER TABLE works.scope_progress
  ADD COLUMN IF NOT EXISTS entry_kind varchar(16) NOT NULL DEFAULT 'progress',
  ADD COLUMN IF NOT EXISTS correction_reason varchar(2048);

ALTER TABLE works.scope_progress DROP CONSTRAINT IF EXISTS ck_scope_progress_entry_kind;
ALTER TABLE works.scope_progress
  ADD CONSTRAINT ck_scope_progress_entry_kind CHECK (entry_kind IN ('progress', 'correction', 'legacy_duplicate'));

-- Negative rows already on file were corrections.
ALTER TABLE works.scope_progress NO FORCE ROW LEVEL SECURITY;
UPDATE works.scope_progress SET entry_kind = 'correction' WHERE current_achievement < 0 AND entry_kind = 'progress';

-- Keep the earliest ordinary row of each (scope, year, month); the rest are legacy duplicates, never deleted.
UPDATE works.scope_progress sp
   SET entry_kind = 'legacy_duplicate'
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY tenant_id, work_scope_id, year, month ORDER BY id) AS rn
      FROM works.scope_progress
     WHERE entry_kind = 'progress'
  ) ranked
 WHERE sp.id = ranked.id AND ranked.rn > 1;
ALTER TABLE works.scope_progress FORCE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS uq_scope_progress_period
  ON works.scope_progress (tenant_id, work_scope_id, year, month)
  WHERE entry_kind = 'progress';
