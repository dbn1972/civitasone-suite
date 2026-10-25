-- 0029_hearings_ecourts_sync_unique.sql
-- Purpose: make the e-Courts sync's check-then-insert of a hearing atomic (CLOS3-S5-15).
-- Affected services: legal-service
--
-- WHY: ecourts/sync-consumer.ts syncMatter() does SELECT-then-INSERT of the next
-- hearing for (case, date) with no unique constraint, so two overlapping sync
-- ticks (or two concurrent syncMatter calls) both saw "no hearing" and inserted
-- the same hearing twice.
--
-- SCOPE: a PARTIAL unique index limited to rows written by the sync's system
-- actor. Users may legitimately record two hearings for one case on one date
-- (e.g. separate sittings), so user-created rows are deliberately NOT
-- constrained. The sync now INSERTs with ON CONFLICT DO NOTHING.
--
-- Pre-step: collapse any pre-existing duplicate system-created rows (keep the
-- oldest), but never delete a row a counsel brief points at. If duplicates
-- remain after that, CREATE UNIQUE INDEX fails loudly rather than guessing.
--
-- Rollback: DROP INDEX IF EXISTS hearings.uq_legal_hearings_ecourts_sync;
-- (the pre-step delete removed only redundant duplicate sync rows and is not reversible).

SET lock_timeout = '5s';

DELETE FROM hearings.legal_hearings h
USING (
  SELECT id,
         row_number() OVER (PARTITION BY tenant_id, case_id, hearing_date ORDER BY created_at, id) AS rn
    FROM hearings.legal_hearings
   WHERE created_by = '00000000-0000-4000-8000-000000000000'
) d
WHERE h.id = d.id
  AND d.rn > 1
  AND NOT EXISTS (SELECT 1 FROM counsel.legal_counsel_briefs b WHERE b.hearing_id = h.id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_hearings_ecourts_sync
  ON hearings.legal_hearings (tenant_id, case_id, hearing_date)
  WHERE created_by = '00000000-0000-4000-8000-000000000000';
