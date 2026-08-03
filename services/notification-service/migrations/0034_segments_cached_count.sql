-- Purpose: repair schema drift that made the whole segments module unreadable.
--
--          src/modules/segments/schema.ts has always declared
--          `cachedCount: integer("cached_count")`, but no migration ever created
--          the column: 0019 created segments.recipient_segments without it and
--          nothing since added it. Every Drizzle `select()` on that table
--          therefore expands to a column list containing cached_count and fails
--          with 42703 "column cached_count does not exist", so GET /v1/segments,
--          GET /v1/segments/:id, GET /v1/segments/:id/preview and PATCH
--          /v1/segments/:id (which reads before it writes) all returned 500 —
--          and the segment.resolve consumer could not read a segment either.
--
--          It went unnoticed because the route tests assert
--          `expect([200, 500]).toContain(res.statusCode)`, which passes while
--          the endpoint is completely broken. Those assertions are tightened in
--          the same change.
--
--          Nullable with no default, exactly as the Drizzle schema declares it:
--          NULL means "this segment has never been resolved", which is a
--          different fact from "resolved to zero recipients". The segment
--          consumer already reads it as `cachedCount ?? 0`.
--
-- Rollback: ALTER TABLE segments.recipient_segments DROP COLUMN IF EXISTS cached_count;
--           (Only safe together with reverting the app: the Drizzle schema
--           expects the column.)
--
-- Affected services: notification-service (segments module)
--
-- Safety: additive and non-blocking. ADD COLUMN of a NULLABLE column with no
-- default is a catalogue-only change in PostgreSQL 16 — no table rewrite, no
-- row is touched, and the ACCESS EXCLUSIVE lock is held for microseconds and
-- bounded by lock_timeout. Idempotent via IF NOT EXISTS, which matters because
-- scripts/dev/migrate-all.mjs keeps no applied-migration ledger and re-runs
-- every file.
SET lock_timeout = '5s';

ALTER TABLE segments.recipient_segments
  ADD COLUMN IF NOT EXISTS cached_count integer;

DO $$
BEGIN
  -- A resolved count is a cardinality: negative is always a bug, and a CHECK is
  -- cheaper than discovering it in a campaign fan-out.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_recipient_segments_cached_count') THEN
    ALTER TABLE segments.recipient_segments
      ADD CONSTRAINT chk_recipient_segments_cached_count
      CHECK (cached_count IS NULL OR cached_count >= 0);
  END IF;
END
$$;

COMMENT ON COLUMN segments.recipient_segments.cached_count IS
  'Recipient count from the last segment resolve. NULL = never resolved, which is not the same as resolved-to-zero.';
