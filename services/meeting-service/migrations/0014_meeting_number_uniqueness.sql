-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 0014_meeting_number_uniqueness.sql
-- Service:   meeting-service — DB civitas_meeting
--
-- UAT F81 / F82: duplicate meeting and resolution numbers.
--   - meeting.meetings had NO unique index on meeting_number. Committees without a code
--     all formatted `MTG/<FY>/<seq>` from a per-committee MAX()+1, and concurrent creates
--     read the same MAX, so one tenant held `MTG/2026-27/001` six times.
--   - meeting.resolutions was only unique per (tenant, meeting, number), so the same
--     `RES/RES/2026-27/001` was issued on two meetings.
--
-- This migration:
--   1. Creates meeting.number_sequences, the transactional (tenant, series, FY) counter used
--      by src/shared/numbering.ts through @civitasone/numbering. RLS forced, like every other
--      tenant table in this schema.
--   2. Adds a nullable test_data_archived_at flag to meetings and resolutions. No existing
--      status or archive column fits: meetings.status 'archived' is a legitimate lifecycle
--      state whose rows must KEEP their unique number, and resolutions have none.
--   3. Archives (never deletes) the existing duplicates, per the owner decision of 31 Oct:
--      in each (tenant, number) group the earliest row (created_at, id) keeps the number,
--      every later row is flagged test_data_archived_at = now(). Status and all other
--      columns are untouched.
--   4. Adds partial UNIQUE indexes on (tenant_id, meeting_number) and
--      (tenant_id, resolution_number), excluding archived rows and NULL/empty numbers.
--      Empty meeting numbers are legitimate: drafts created by the series generator get
--      their number only on draft -> scheduled.
--
-- Idempotent: IF NOT EXISTS everywhere; step 3 only touches rows that are still duplicated
-- among non-archived rows, so a re-run archives nothing. Steps 2-4 run in one transaction,
-- so the indexes can never be created half way.
--
-- RLS: this runs as the table OWNER (meeting_svc), which is NOBYPASSRLS, so FORCE RLS would
-- hide every row from the cross-tenant archive UPDATE. FORCE is dropped for the UPDATE and
-- restored in the same transaction (the sanctioned backfill idiom, house rule §4.3). The
-- UPDATE is tenant-safe: it only sets a flag on rows in place.
--
-- Preview on UAT (SELECT only) of what step 3 would archive:
--   SELECT tenant_id, meeting_number, id, created_at FROM (
--     SELECT *, row_number() OVER (PARTITION BY tenant_id, meeting_number ORDER BY created_at, id) rn
--     FROM meeting.meetings WHERE COALESCE(meeting_number, '') <> '') x WHERE rn > 1;
--   (same shape for meeting.resolutions / resolution_number)
--
-- Rollback (DESTRUCTIVE to the new guard — tech-lead / DBA approval required):
--   DROP INDEX IF EXISTS meeting.uq_meetings_tenant_number;
--   DROP INDEX IF EXISTS meeting.uq_resolutions_tenant_number;
--   -- archived flags and the counter table may stay; they are inert without the new code.
-- ═══════════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

-- ── 1. Counter table ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meeting.number_sequences (
  tenant_id     UUID        NOT NULL,
  series_key    TEXT        NOT NULL,   -- e.g. 'meeting:MTG', 'resolution:FC/RES'
  bucket        TEXT        NOT NULL,   -- financial year, e.g. '2026-27'
  current_value BIGINT      NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, series_key, bucket)
);

ALTER TABLE meeting.number_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting.number_sequences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS number_sequences_tenant ON meeting.number_sequences;
CREATE POLICY number_sequences_tenant ON meeting.number_sequences
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'meeting_scanner') THEN
    GRANT SELECT ON meeting.number_sequences TO meeting_scanner;
  END IF;
END
$$;

BEGIN;

-- ── 2. Archive flag ──────────────────────────────────────────────────────────────
ALTER TABLE meeting.meetings    ADD COLUMN IF NOT EXISTS test_data_archived_at TIMESTAMPTZ;
ALTER TABLE meeting.resolutions ADD COLUMN IF NOT EXISTS test_data_archived_at TIMESTAMPTZ;

-- ── 3. Archive existing duplicates (keep the earliest row of each group) ─────────
ALTER TABLE meeting.meetings    NO FORCE ROW LEVEL SECURITY;
ALTER TABLE meeting.resolutions NO FORCE ROW LEVEL SECURITY;

UPDATE meeting.meetings m
   SET test_data_archived_at = now()
  FROM (
    SELECT id, row_number() OVER (PARTITION BY tenant_id, meeting_number ORDER BY created_at, id) AS rn
      FROM meeting.meetings
     WHERE test_data_archived_at IS NULL
       AND meeting_number IS NOT NULL AND meeting_number <> ''
  ) d
 WHERE m.id = d.id AND d.rn > 1;

UPDATE meeting.resolutions r
   SET test_data_archived_at = now()
  FROM (
    SELECT id, row_number() OVER (PARTITION BY tenant_id, resolution_number ORDER BY created_at, id) AS rn
      FROM meeting.resolutions
     WHERE test_data_archived_at IS NULL
       AND resolution_number IS NOT NULL AND resolution_number <> ''
  ) d
 WHERE r.id = d.id AND d.rn > 1;

ALTER TABLE meeting.meetings    FORCE ROW LEVEL SECURITY;
ALTER TABLE meeting.resolutions FORCE ROW LEVEL SECURITY;

-- ── 4. Enforce uniqueness ────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_meetings_tenant_number
    ON meeting.meetings (tenant_id, meeting_number)
 WHERE test_data_archived_at IS NULL AND meeting_number IS NOT NULL AND meeting_number <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_resolutions_tenant_number
    ON meeting.resolutions (tenant_id, resolution_number)
 WHERE test_data_archived_at IS NULL AND resolution_number IS NOT NULL AND resolution_number <> '';

COMMIT;
