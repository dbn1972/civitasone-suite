-- Purpose: P1-6 — allow `bounces.suppression_list.source = 'inbound'` so a
--          recipient-initiated opt-out (an SMS / WhatsApp "STOP" matching a
--          keyword rule) can be recorded as what it actually is.
--
--          `chk_suppression_list_source` (migration 0026) permitted only
--          ('bounce', 'complaint', 'manual', 'import'). None of those describes a
--          recipient who unsubscribed themselves: recording it as 'manual' would
--          claim an operator made the decision, which is exactly the fact an
--          audit of a consent withdrawal needs to be able to distinguish.
--
--          `reason = 'unsubscribe'` was ALREADY permitted by
--          chk_suppression_list_reason in 0026 — only `source` needed widening.
--
-- Rollback: UPDATE bounces.suppression_list SET source = 'manual' WHERE source = 'inbound';
--           ALTER TABLE bounces.suppression_list DROP CONSTRAINT chk_suppression_list_source;
--           ALTER TABLE bounces.suppression_list ADD CONSTRAINT chk_suppression_list_source
--             CHECK (source IN ('bounce', 'complaint', 'manual', 'import'));
--
-- Affected services: notification-service (inbox opt-out consumer, bounces module)
--
-- Safety: additive (widens an accepted value set — no existing row can become
-- invalid), idempotent (guarded on the constraint definition already naming
-- 'inbound', so a re-run is a no-op: `scripts/dev/migrate-all.mjs` keeps no
-- applied-migration ledger and re-runs every file). DROP + ADD run inside the
-- single implicit transaction of the DO block, so there is never a window in
-- which the column is unconstrained. No table rewrite; ADD CONSTRAINT validates
-- with one sequential scan of a small operational table, bounded by lock_timeout.
SET lock_timeout = '5s';

DO $$
BEGIN
  -- Table absent → 0026 has not run yet; nothing to widen.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'bounces' AND table_name = 'suppression_list'
  ) THEN
    RETURN;
  END IF;

  -- Already widened (or hand-edited to permit 'inbound') → no-op on re-run.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_suppression_list_source'
      AND pg_get_constraintdef(oid) LIKE '%inbound%'
  ) THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_suppression_list_source') THEN
    ALTER TABLE bounces.suppression_list DROP CONSTRAINT chk_suppression_list_source;
  END IF;

  ALTER TABLE bounces.suppression_list
    ADD CONSTRAINT chk_suppression_list_source
    CHECK (source IN ('bounce', 'complaint', 'manual', 'import', 'inbound'));
END $$;

COMMENT ON COLUMN bounces.suppression_list.source IS
  'Who caused the suppression: bounce | complaint | manual | import | inbound (recipient replied STOP).';
