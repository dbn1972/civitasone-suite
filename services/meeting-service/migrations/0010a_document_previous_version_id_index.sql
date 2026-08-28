-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 0010a_document_previous_version_id_index.sql
-- Service:   meeting-service (port 3033, gateway /api/v1/meetings) — DB civitas_meeting
--
-- Purpose:
--   migrations/0009_document_previous_version_fk.sql added the self-referential FK
--   meeting.meeting_documents.previous_version_id → meeting_documents(id)
--   (ON DELETE SET NULL) but NO supporting index on the referencing column. The two
--   sibling FK columns on the SAME table already have one each (0001_meeting_core.sql:
--   idx_docs_meeting on meeting_id, idx_docs_agenda on agenda_item_id); previous_version_id
--   was the lone FK column left un-indexed. This migration closes that asymmetry.
--
--   Without it, two operations seq-scan meeting_documents:
--     1. The 0009 data-hygiene scan (and any future re-run / lineage audit) that filters
--        `previous_version_id IS NOT NULL`.
--     2. Postgres's own FK enforcement: an ON DELETE SET NULL on a self-referential FK
--        must, on every delete of a document row, find the rows whose previous_version_id
--        references the deleted id and null them out — a reverse lookup on this exact
--        column. document.remove is a soft-delete today, but a hard-delete / retention-purge
--        path would trigger that reverse lookup per deleted row.
--
--   ADDITIVE and IDEMPOTENT: CREATE INDEX IF NOT EXISTS, so safe to re-run in any
--   environment. Plain (non-CONCURRENT) build — consistent with 0001's index block and
--   0009's ALTER: this repo's migration runner applies each file as a unit (CREATE INDEX
--   CONCURRENTLY cannot run inside a transaction block), and meeting_documents is a
--   low-volume, per-meeting table, so the brief lock is acceptable. lock_timeout bounds it.
--
-- Rollback (DESTRUCTIVE — requires tech-lead / DBA written approval per Migration
--           Safety Rules; no automatic down-migration is provided):
--   DROP INDEX IF EXISTS meeting.idx_docs_previous_version;
--
-- Renamed from 0010_document_previous_version_id_index.sql to 0010a_ — this branch
-- was cut before migrations/0010_core_lifecycle_constraints.sql claimed the plain
-- 0010 slot on main. The two files touch disjoint tables (meeting_documents here vs.
-- meetings/participants/agenda_items/attendance_records there) with no ordering
-- dependency, so only this file moves; 0010_core_lifecycle_constraints.sql is
-- untouched.
-- ═══════════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

-- Btree index on the referencing column of the 0009 self-referential FK, mirroring the
-- sibling FK-column indexes (idx_docs_meeting, idx_docs_agenda) on this table.
CREATE INDEX IF NOT EXISTS idx_docs_previous_version
  ON meeting.meeting_documents(previous_version_id);
